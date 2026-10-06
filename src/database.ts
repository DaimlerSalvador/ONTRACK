// ─────────────────────────────────────────────────────────────────────────────
// ONTRACK — localStorage SQL database
// Tables: users, rooms, room_members, tasks, task_deps, messages, notifications
// All operations mirror SQL semantics: SELECT / INSERT / UPDATE / DELETE
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus = 'not-started' | 'in-progress' | 'submitted' | 'done' | 'revision' | 'late'
export type Role = 'leader' | 'member'

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface User {
  id: string
  name: string
  email: string
  password: string
  createdAt: string
}

export interface Room {
  id: string
  title: string
  description: string
  leaderId: string
  color: string
  code: string
  archived: boolean
  createdAt: string
}

export interface RoomMember {
  roomId: string
  userId: string
  role: Role
  joinedAt: string
}

export interface Task {
  id: string
  roomId: string
  title: string
  description: string
  assigneeIds: string[]
  deadline: string
  status: TaskStatus
  submissionLink?: string
  x: number
  y: number
  createdAt: string
}

export interface TaskDep {
  taskId: string
  dependsOnId: string
}

export interface Message {
  id: string
  roomId: string
  senderId: string
  text: string
  createdAt: string
}

export interface Notification {
  id: string
  userId: string
  text: string
  read: boolean
  createdAt: string
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const NS = 'ontrack_'

function select<T>(table: string): T[] {
  try {
    const raw = localStorage.getItem(NS + table)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

function save<T>(table: string, rows: T[]): void {
  localStorage.setItem(NS + table, JSON.stringify(rows))
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function now(): string {
  return new Date().toISOString()
}

export function migrateDB(): void {
  const raw = localStorage.getItem(NS + 'tasks')
  if (!raw) return
  try {
    const tasks: any[] = JSON.parse(raw)
    const changed = tasks.some(t => 'assigneeId' in t && !('assigneeIds' in t))
    if (!changed) return
    const migrated = tasks.map(t => {
      if ('assigneeId' in t && !('assigneeIds' in t)) {
        const { assigneeId, ...rest } = t
        return { ...rest, assigneeIds: assigneeId ? [assigneeId] : [] }
      }
      return t
    })
    localStorage.setItem(NS + 'tasks', JSON.stringify(migrated))
  } catch {
    // ignore migration errors
  }
}

// ─── DB init & seed ───────────────────────────────────────────────────────────

export function initDB(): void {
  if (localStorage.getItem(NS + 'initialized') === 'true') return

  // -- users --
  const users: User[] = [
    { id: 'u1', name: 'Alex Rivera', email: 'alex@uni.edu', password: 'password', createdAt: now() },
    { id: 'u2', name: 'Isabel Cruz', email: 'isabel@uni.edu', password: 'password', createdAt: now() },
    { id: 'u3', name: 'Henry Park', email: 'henry@uni.edu', password: 'password', createdAt: now() },
    { id: 'u4', name: 'Raphael Tan', email: 'raphael@uni.edu', password: 'password', createdAt: now() },
    { id: 'u5', name: 'Maria Santos', email: 'maria@uni.edu', password: 'password', createdAt: now() },
  ]
  save('users', users)

  // -- rooms --
  const rooms: Room[] = [
    { id: 'r1', title: 'Capstone Project Alpha', description: 'AI-driven systems for smart campus infrastructure', leaderId: 'u1', color: '#7a1c1c', code: 'CAP001', archived: false, createdAt: now() },
    { id: 'r2', title: 'Thesis Research Group', description: 'Machine learning applications in healthcare diagnostics', leaderId: 'u3', color: '#1a5230', code: 'THR002', archived: false, createdAt: now() },
    { id: 'r3', title: 'Systems Integration Lab', description: 'Integration testing and validation for distributed systems', leaderId: 'u1', color: '#152850', code: 'SYS003', archived: false, createdAt: now() },
    { id: 'r4', title: 'Software Engineering 301', description: 'Group project for SE301 final requirement', leaderId: 'u2', color: '#7a6200', code: 'SE3004', archived: true, createdAt: now() },
  ]
  save('rooms', rooms)

  // -- members --
  const members: RoomMember[] = [
    { roomId: 'r1', userId: 'u1', role: 'leader', joinedAt: now() },
    { roomId: 'r1', userId: 'u2', role: 'member', joinedAt: now() },
    { roomId: 'r1', userId: 'u3', role: 'member', joinedAt: now() },
    { roomId: 'r1', userId: 'u4', role: 'member', joinedAt: now() },
    { roomId: 'r2', userId: 'u1', role: 'member', joinedAt: now() },
    { roomId: 'r2', userId: 'u3', role: 'leader', joinedAt: now() },
    { roomId: 'r2', userId: 'u5', role: 'member', joinedAt: now() },
    { roomId: 'r3', userId: 'u1', role: 'leader', joinedAt: now() },
    { roomId: 'r3', userId: 'u4', role: 'member', joinedAt: now() },
    { roomId: 'r4', userId: 'u1', role: 'member', joinedAt: now() },
    { roomId: 'r4', userId: 'u2', role: 'leader', joinedAt: now() },
  ]
  save('members', members)

  // -- tasks --
  const tasks: Task[] = [
    { id: 't1', roomId: 'r1', title: 'Project Start',     description: 'Initialize repo, set up scaffolding and CI pipeline.',                      assigneeIds: ['u1'], deadline: '2025-01-15', status: 'done',        x: 280, y: 50,  createdAt: now() },
    { id: 't2', roomId: 'r1', title: 'Documentation',     description: 'Write comprehensive project docs and technical specification.',              assigneeIds: ['u2'], deadline: '2025-02-10', status: 'done',        x: 520, y: 50,  createdAt: now() },
    { id: 't3', roomId: 'r1', title: 'UI/UX Design',      description: 'Design interface mockups and interactive prototypes in Figma.',              assigneeIds: ['u3'], deadline: '2025-02-25', status: 'in-progress', x: 760, y: 50,  createdAt: now() },
    { id: 't4', roomId: 'r1', title: 'Frontend Coding',   description: 'Implement the React frontend using approved designs.',                      assigneeIds: ['u1'], deadline: '2025-03-20', status: 'not-started', x: 420, y: 200, createdAt: now() },
    { id: 't5', roomId: 'r1', title: 'Backend Coding',    description: 'Build REST API endpoints, database models and authentication.',             assigneeIds: ['u4'], deadline: '2025-03-20', status: 'not-started', x: 700, y: 200, createdAt: now() },
    { id: 't6', roomId: 'r1', title: 'User Testing',      description: 'Conduct QA rounds and gather feedback from recruited test users.',          assigneeIds: ['u2'], deadline: '2025-04-05', status: 'not-started', x: 560, y: 340, createdAt: now() },
    { id: 't7', roomId: 'r1', title: 'Project End',       description: 'Final submission, panel presentation and project handover.',                assigneeIds: ['u1'], deadline: '2025-04-20', status: 'not-started', x: 560, y: 460, createdAt: now() },
    { id: 't8', roomId: 'r2', title: 'Literature Review', description: 'Survey existing research on ML diagnostics and identify key gaps.',         assigneeIds: ['u1'], deadline: '2025-02-28', status: 'submitted',   x: 160, y: 80,  createdAt: now() },
    { id: 't9', roomId: 'r2', title: 'Data Collection',   description: 'Gather, clean and normalise healthcare datasets for training.',             assigneeIds: ['u5'], deadline: '2025-03-15', status: 'in-progress', x: 420, y: 80,  createdAt: now() },
    { id: 'ta', roomId: 'r3', title: 'Architecture Review','description': 'Review system architecture and propose scalability improvements.',       assigneeIds: ['u1'], deadline: '2025-03-01', status: 'done',        x: 160, y: 80,  createdAt: now() },
    { id: 'tb', roomId: 'r3', title: 'API Integration',   description: 'Integrate third-party APIs and implement service mesh.',                    assigneeIds: ['u4'], deadline: '2025-03-20', status: 'revision',    x: 420, y: 80,  createdAt: now() },
  ]
  save('tasks', tasks)

  // -- task dependencies --
  const deps: TaskDep[] = [
    { taskId: 't2', dependsOnId: 't1' },
    { taskId: 't3', dependsOnId: 't2' },
    { taskId: 't4', dependsOnId: 't3' },
    { taskId: 't5', dependsOnId: 't3' },
    { taskId: 't6', dependsOnId: 't4' },
    { taskId: 't6', dependsOnId: 't5' },
    { taskId: 't7', dependsOnId: 't6' },
    { taskId: 't9', dependsOnId: 't8' },
    { taskId: 'tb', dependsOnId: 'ta' },
  ]
  save('task_deps', deps)

  // -- messages --
  const msgs: Message[] = [
    { id: 'm1', roomId: 'r1', senderId: 'u2', text: "Hey everyone! Just finished the documentation draft. It's looking solid.", createdAt: new Date(Date.now() - 18000000).toISOString() },
    { id: 'm2', roomId: 'r1', senderId: 'u3', text: "Great work! I'll review it this afternoon and leave comments.",            createdAt: new Date(Date.now() - 16200000).toISOString() },
    { id: 'm3', roomId: 'r1', senderId: 'u4', text: 'Should we schedule a sync call this week to align on the API specs?',    createdAt: new Date(Date.now() - 14400000).toISOString() },
    { id: 'm4', roomId: 'r1', senderId: 'u1', text: "Yes, Thursday at 3 PM works. I'll send a calendar invite.",               createdAt: new Date(Date.now() - 12600000).toISOString() },
    { id: 'm5', roomId: 'r1', senderId: 'u2', text: 'Thursday works! Will the meeting be recorded?',                           createdAt: new Date(Date.now() -  7200000).toISOString() },
  ]
  save('messages', msgs)

  // -- notifications --
  const notifs: Notification[] = [
    { id: 'n1', userId: 'u1', text: 'Your task "Frontend Coding" is due in 3 days.',              read: false, createdAt: new Date(Date.now() -  7200000).toISOString() },
    { id: 'n2', userId: 'u1', text: 'Isabel submitted "Documentation" — pending your review.',    read: false, createdAt: new Date(Date.now() - 18000000).toISOString() },
    { id: 'n3', userId: 'u1', text: 'Henry updated "UI/UX Design" status to In Progress.',        read: true,  createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: 'n4', userId: 'u1', text: 'Leader approved "Architecture Review" in Systems Lab.',       read: true,  createdAt: new Date(Date.now() -172800000).toISOString() },
  ]
  save('notifications', notifs)

  localStorage.setItem(NS + 'session', 'u1')
  localStorage.setItem(NS + 'initialized', 'true')
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE: users
// ─────────────────────────────────────────────────────────────────────────────

export const userDB = {
  /** SELECT * FROM users */
  all(): User[] { return select<User>('users') },

  /** SELECT * FROM users WHERE id = ? */
  find(id: string): User | undefined {
    return select<User>('users').find(u => u.id === id)
  },

  /** SELECT * FROM users WHERE email = ? */
  findByEmail(email: string): User | undefined {
    return select<User>('users').find(u => u.email.toLowerCase() === email.toLowerCase())
  },

  /** INSERT INTO users VALUES (?) */
  insert(data: Omit<User, 'id' | 'createdAt'>): User {
    const row: User = { ...data, id: uid(), createdAt: now() }
    const rows = select<User>('users')
    rows.push(row)
    save('users', rows)
    return row
  },

  /** UPDATE users SET ? WHERE id = ? */
  update(id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): User | null {
    const rows = select<User>('users')
    const i = rows.findIndex(u => u.id === id)
    if (i === -1) return null
    rows[i] = { ...rows[i], ...data }
    save('users', rows)
    return rows[i]
  },

  // -- session helpers --
  session(): User | null {
    const id = localStorage.getItem(NS + 'session')
    return id ? (userDB.find(id) ?? null) : null
  },
  setSession(id: string | null): void {
    if (id) localStorage.setItem(NS + 'session', id)
    else localStorage.removeItem(NS + 'session')
  },

  /** Authenticate: returns user on success or error string */
  login(email: string, password: string): User | string {
    const u = userDB.findByEmail(email)
    if (!u) return 'No account found with that email.'
    if (u.password !== password) return 'Incorrect password.'
    userDB.setSession(u.id)
    return u
  },

  /** Register: inserts user and opens session or returns error */
  register(name: string, email: string, password: string): User | string {
    if (!name.trim()) return 'Name is required.'
    if (!email.includes('@')) return 'Enter a valid email.'
    if (password.length < 6) return 'Password must be at least 6 characters.'
    if (userDB.findByEmail(email)) return 'That email is already registered.'
    const u = userDB.insert({ name: name.trim(), email: email.trim(), password })
    userDB.setSession(u.id)
    return u
  },

  logout(): void { userDB.setSession(null) },
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE: rooms
// ─────────────────────────────────────────────────────────────────────────────

export const roomDB = {
  /** SELECT * FROM rooms */
  all(): Room[] { return select<Room>('rooms') },

  /** SELECT * FROM rooms WHERE id = ? */
  find(id: string): Room | undefined {
    return select<Room>('rooms').find(r => r.id === id)
  },

  /** SELECT rooms WHERE code = ? */
  findByCode(code: string): Room | undefined {
    return select<Room>('rooms').find(r => r.code === code.trim().toUpperCase())
  },

  /** SELECT rooms joined with room_members WHERE userId = ? */
  forUser(userId: string): Room[] {
    const ids = new Set(
      select<RoomMember>('members').filter(m => m.userId === userId).map(m => m.roomId)
    )
    return select<Room>('rooms').filter(r => ids.has(r.id))
  },

  /** INSERT INTO rooms VALUES (?) — also inserts leader into room_members */
  insert(data: { title: string; description: string; leaderId: string; color: string }): Room {
    const room: Room = {
      id: uid(),
      title: data.title.trim() || 'Untitled Project',
      description: data.description.trim(),
      leaderId: data.leaderId,
      color: data.color,
      code: Math.random().toString(36).slice(2, 8).toUpperCase(),
      archived: false,
      createdAt: now(),
    }
    const rows = select<Room>('rooms')
    rows.push(room)
    save('rooms', rows)
    memberDB.insert(room.id, data.leaderId, 'leader')
    return room
  },

  /** UPDATE rooms SET ? WHERE id = ? */
  update(id: string, data: Partial<Omit<Room, 'id' | 'createdAt'>>): Room | null {
    const rows = select<Room>('rooms')
    const i = rows.findIndex(r => r.id === id)
    if (i === -1) return null
    rows[i] = { ...rows[i], ...data }
    save('rooms', rows)
    return rows[i]
  },

  /** DELETE FROM rooms WHERE id = ? — cascades tasks, members, messages */
  delete(id: string): void {
    save('rooms', select<Room>('rooms').filter(r => r.id !== id))
    const taskIds = select<Task>('tasks').filter(t => t.roomId === id).map(t => t.id)
    save('tasks', select<Task>('tasks').filter(t => t.roomId !== id))
    save('task_deps', select<TaskDep>('task_deps').filter(d => !taskIds.includes(d.taskId) && !taskIds.includes(d.dependsOnId)))
    save('members', select<RoomMember>('members').filter(m => m.roomId !== id))
    save('messages', select<Message>('messages').filter(m => m.roomId !== id))
  },

  /** Join room by code */
  join(code: string, userId: string): Room | string {
    const room = roomDB.findByCode(code)
    if (!room) return 'Room not found. Check the code and try again.'
    if (room.archived) return 'This room is archived and not accepting members.'
    if (memberDB.find(room.id, userId)) return 'You are already a member of this room.'
    memberDB.insert(room.id, userId, 'member')
    notifDB.insert(room.leaderId, `${userDB.find(userId)?.name ?? 'Someone'} joined "${room.title}".`)
    return room
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE: room_members
// ─────────────────────────────────────────────────────────────────────────────

export const memberDB = {
  /** SELECT * FROM room_members WHERE roomId = ? */
  forRoom(roomId: string): RoomMember[] {
    return select<RoomMember>('members').filter(m => m.roomId === roomId)
  },

  /** SELECT * FROM room_members WHERE roomId = ? AND userId = ? */
  find(roomId: string, userId: string): RoomMember | undefined {
    return select<RoomMember>('members').find(m => m.roomId === roomId && m.userId === userId)
  },

  role(roomId: string, userId: string): Role | null {
    return memberDB.find(roomId, userId)?.role ?? null
  },

  /** INSERT INTO room_members VALUES (?) */
  insert(roomId: string, userId: string, role: Role): RoomMember {
    const row: RoomMember = { roomId, userId, role, joinedAt: now() }
    const rows = select<RoomMember>('members')
    rows.push(row)
    save('members', rows)
    return row
  },

  /** DELETE FROM room_members WHERE roomId = ? AND userId = ? */
  delete(roomId: string, userId: string): void {
    save('members', select<RoomMember>('members').filter(m => !(m.roomId === roomId && m.userId === userId)))
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE: tasks
// ─────────────────────────────────────────────────────────────────────────────

export const taskDB = {
  /** SELECT * FROM tasks WHERE roomId = ? */
  forRoom(roomId: string): Task[] {
    return select<Task>('tasks').filter(t => t.roomId === roomId)
  },

  /** SELECT * FROM tasks WHERE assigneeIds CONTAINS ? [AND roomId = ?] */
  forUser(userId: string, roomId?: string): Task[] {
    let rows = select<Task>('tasks').filter(t => t.assigneeIds.includes(userId))
    if (roomId) rows = rows.filter(t => t.roomId === roomId)
    return rows
  },

  /** SELECT dependsOnId FROM task_deps WHERE taskId = ? */
  deps(taskId: string): string[] {
    return select<TaskDep>('task_deps').filter(d => d.taskId === taskId).map(d => d.dependsOnId)
  },

  /** INSERT INTO tasks VALUES (?) — also inserts deps */
  insert(data: Omit<Task, 'id' | 'createdAt'>, deps: string[] = []): Task {
    const task: Task = { ...data, id: uid(), createdAt: now() }
    const rows = select<Task>('tasks')
    rows.push(task)
    save('tasks', rows)
    if (deps.length) {
      const depRows = select<TaskDep>('task_deps')
      deps.forEach(d => depRows.push({ taskId: task.id, dependsOnId: d }))
      save('task_deps', depRows)
    }
    if (data.assigneeIds.length) {
      data.assigneeIds.forEach(aid => notifDB.insert(aid, `You've been assigned to "${task.title}". Due: ${task.deadline}.`))
    }
    return task
  },

  /** UPDATE tasks SET ? WHERE id = ? */
  update(id: string, data: Partial<Omit<Task, 'id' | 'roomId' | 'createdAt'>>): Task | null {
    const rows = select<Task>('tasks')
    const i = rows.findIndex(t => t.id === id)
    if (i === -1) return null
    rows[i] = { ...rows[i], ...data }
    save('tasks', rows)
    return rows[i]
  },

  /** DELETE FROM tasks WHERE id = ? */
  delete(id: string): void {
    save('tasks', select<Task>('tasks').filter(t => t.id !== id))
    save('task_deps', select<TaskDep>('task_deps').filter(d => d.taskId !== id && d.dependsOnId !== id))
  },

  /** REPLACE task_deps for a task */
  setDeps(taskId: string, deps: string[]): void {
    save('task_deps', select<TaskDep>('task_deps').filter(d => d.taskId !== taskId))
    const rows = select<TaskDep>('task_deps')
    deps.filter(d => d !== taskId).forEach(d => rows.push({ taskId, dependsOnId: d }))
    save('task_deps', rows)
  },

  /** Mark overdue tasks as late and notify assignees. Returns updated tasks. */
  checkLate(roomId: string): Task[] {
    const tasks = select<Task>('tasks').filter(t => t.roomId === roomId)
    const now = Date.now()
    const updated: Task[] = []
    tasks.forEach(task => {
      if ((task.status === 'not-started' || task.status === 'in-progress' || task.status === 'revision') && new Date(task.deadline).getTime() < now) {
        const t = taskDB.update(task.id, { status: 'late' })
        if (t) updated.push(t)
        task.assigneeIds.forEach(aid => notifDB.insert(aid, `Task "${task.title}" is late. Deadline was ${task.deadline}.`))
      }
    })
    return updated
  },

  /** Submit task — updates status and notifies leader */
  submit(id: string, link: string, leaderId: string): Task | null {
    const task = taskDB.update(id, { status: 'submitted', submissionLink: link })
    if (task) notifDB.insert(leaderId, `"${task.title}" was submitted and is ready for review.`)
    return task
  },

  /** Leader approves task */
  approve(id: string, assigneeIds: string[]): Task | null {
    const task = taskDB.update(id, { status: 'done' })
    if (task) assigneeIds.forEach(aid => notifDB.insert(aid, `Your task "${task.title}" was approved! ✓`))
    return task
  },

  /** Leader requests revision */
  requestRevision(id: string, assigneeIds: string[]): Task | null {
    const task = taskDB.update(id, { status: 'revision' })
    if (task) assigneeIds.forEach(aid => notifDB.insert(aid, `Your task "${task.title}" needs revision. Check the feedback.`))
    return task
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE: messages
// ─────────────────────────────────────────────────────────────────────────────

export const messageDB = {
  /** SELECT * FROM messages WHERE roomId = ? ORDER BY createdAt */
  forRoom(roomId: string): Message[] {
    return select<Message>('messages')
      .filter(m => m.roomId === roomId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  },

  /** INSERT INTO messages VALUES (?) */
  insert(roomId: string, senderId: string, text: string): Message {
    const msg: Message = { id: uid(), roomId, senderId, text: text.trim(), createdAt: now() }
    const rows = select<Message>('messages')
    rows.push(msg)
    save('messages', rows)
    return msg
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE: notifications
// ─────────────────────────────────────────────────────────────────────────────

export const notifDB = {
  /** SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC */
  forUser(userId: string): Notification[] {
    return select<Notification>('notifications')
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  /** SELECT COUNT(*) FROM notifications WHERE userId = ? AND read = 0 */
  unreadCount(userId: string): number {
    return select<Notification>('notifications').filter(n => n.userId === userId && !n.read).length
  },

  /** INSERT INTO notifications VALUES (?) */
  insert(userId: string, text: string): Notification {
    const row: Notification = { id: uid(), userId, text, read: false, createdAt: now() }
    const rows = select<Notification>('notifications')
    rows.push(row)
    save('notifications', rows)
    return row
  },

  /** UPDATE notifications SET read = 1 WHERE id = ? */
  markRead(id: string): void {
    const rows = select<Notification>('notifications')
    const i = rows.findIndex(n => n.id === id)
    if (i !== -1) { rows[i].read = true; save('notifications', rows) }
  },

  /** UPDATE notifications SET read = 1 WHERE userId = ? */
  markAllRead(userId: string): void {
    const rows = select<Notification>('notifications').map(n =>
      n.userId === userId ? { ...n, read: true } : n
    )
    save('notifications', rows)
  },
}

// ─── Utility: format relative time ───────────────────────────────────────────

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
