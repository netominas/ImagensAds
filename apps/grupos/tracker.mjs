// Lógica que decide quem entrou e quem saiu de cada grupo. Não depende do WhatsApp, então é testável.
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const saoPauloDay = (date = new Date()) => dayFormat.format(date); // AAAA-MM-DD

export const bare = jid => (jid ? String(jid).split('@')[0].split(':')[0] : '');
const normalize = p => (typeof p === 'string' ? { id: p } : p);
const phoneOf = p => bare(p.phoneNumber || (String(p.id).endsWith('@s.whatsapp.net') ? p.id : ''));
const idsOf = p => [p.id, p.lid, p.phoneNumber].map(bare).filter(Boolean);

export function createTracker(db, { clock = () => new Date() } = {}) {
  const now = () => Math.floor(clock().getTime() / 1000);
  const today = () => saoPauloDay(clock());
  const q = {
    group: db.prepare('SELECT id FROM wpp_groups WHERE id=?'),
    saveGroup: db.prepare(`INSERT INTO wpp_groups (id,name,size,is_admin,active,updated) VALUES (?,?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,size=excluded.size,is_admin=excluded.is_admin,active=1,updated=excluded.updated`),
    members: db.prepare('SELECT member_id FROM wpp_members WHERE group_id=?'),
    hasMember: db.prepare('SELECT 1 FROM wpp_members WHERE group_id=? AND member_id=?'),
    addMember: db.prepare('INSERT OR IGNORE INTO wpp_members (group_id,member_id,phone) VALUES (?,?,?)'),
    delMember: db.prepare('DELETE FROM wpp_members WHERE group_id=? AND member_id=?'),
    event: db.prepare('INSERT INTO wpp_events (group_id,member_id,phone,kind,detail,source,ts,day) VALUES (?,?,?,?,?,?,?,?)'),
    dailySize: db.prepare(`INSERT INTO wpp_daily_size (group_id,day,size) VALUES (?,?,?)
      ON CONFLICT(group_id,day) DO UPDATE SET size=excluded.size`),
    setSize: db.prepare('UPDATE wpp_groups SET size=?,updated=? WHERE id=?'),
    rename: db.prepare('UPDATE wpp_groups SET name=? WHERE id=?'),
    activeIds: db.prepare('SELECT id FROM wpp_groups WHERE active=1'),
    deactivate: db.prepare('UPDATE wpp_groups SET active=0 WHERE id=?'),
  };
  const transaction = fn => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const record = (groupId, memberId, phone, kind, detail, source) =>
    q.event.run(groupId, memberId, phone, kind, detail, source, now(), today());

  // Compara a lista atual de membros com a guardada e registra a diferença.
  function syncGroup(g, myIds = []) {
    const known = !!q.group.get(g.id);
    const participants = (g.participants || []).map(normalize);
    const current = new Map(participants.map(p => [p.id, phoneOf(p)]));
    const isAdmin = participants.some(p => (p.admin || p.isAdmin) && idsOf(p).some(x => myIds.includes(x))) ? 1 : 0;
    transaction(() => {
      q.saveGroup.run(g.id, g.subject || '(sem nome)', current.size, isAdmin, now());
      const stored = new Set(q.members.all(g.id).map(r => r.member_id));
      if (!known) {
        // Primeira vez que o grupo aparece: guarda a foto inicial sem inventar "entradas".
        for (const [id, phone] of current) q.addMember.run(g.id, id, phone);
      } else {
        for (const [id, phone] of current) if (!stored.has(id)) { q.addMember.run(g.id, id, phone); record(g.id, id, phone, 'join', 'detected', 'sync'); }
        for (const id of stored) if (!current.has(id)) { q.delMember.run(g.id, id); record(g.id, id, '', 'leave', 'detected', 'sync'); }
      }
      q.dailySize.run(g.id, today(), current.size);
    });
  }

  function syncAll(groups, myIds) {
    for (const g of groups) syncGroup(g, myIds);
    const present = new Set(groups.map(g => g.id));
    for (const { id } of q.activeIds.all()) if (!present.has(id)) q.deactivate.run(id);
  }

  // Evento ao vivo. Devolve quantos registros criou.
  function handleParticipants({ id: groupId, author, authorPn, participants, action }) {
    if (action !== 'add' && action !== 'remove') return 0;
    if (!q.group.get(groupId)) return 0; // grupo ainda desconhecido: a sincronização cuida dele
    const authors = [author, authorPn].map(bare).filter(Boolean);
    let created = 0;
    transaction(() => {
      for (const p of participants.map(normalize)) {
        const phone = phoneOf(p);
        const self = authors.some(a => idsOf(p).includes(a));
        if (action === 'add') {
          if (q.hasMember.get(groupId, p.id)) continue;
          q.addMember.run(groupId, p.id, phone);
          record(groupId, p.id, phone, 'join', self ? 'joined' : 'added', 'live');
        } else {
          if (!q.hasMember.get(groupId, p.id)) continue;
          q.delMember.run(groupId, p.id);
          record(groupId, p.id, phone, 'leave', self ? 'left' : 'removed', 'live');
        }
        created++;
      }
      const total = q.members.all(groupId).length;
      q.setSize.run(total, now(), groupId);
      q.dailySize.run(groupId, today(), total);
    });
    return created;
  }

  return { syncGroup, syncAll, handleParticipants, rename: (id, name) => q.rename.run(name, id) };
}
