import { useState, useEffect, useRef, useCallback } from 'react'
import {
  initDB, migrateDB, userDB, roomDB, memberDB, taskDB, messageDB, notifDB,
  relativeTime, fmtTime, now,
  type User, type Room, type RoomMember, type Task, type Message,
  type Notification, type TaskStatus, type Role,
} from './database'
import { waitForFirebase } from './firebase'
import { initFirebaseSync, writeRow, deleteRow, syncTable } from './firebase-db'

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'landing' | 'login' | 'register' | 'home' | 'room' | 'profile' | 'archived'
type RoomTab = 'flowchart' | 'mytasks' | 'chat' | 'members' | 'settings'

const ROOM_COLORS = ['#7a1c1c', '#1a5230', '#152850', '#7a6200', '#4a1080', '#1a4a5c']

const STATUS: Record<TaskStatus, { label: string; nodeColor: string; nodeBorder: string; nodeText: string; dot: string; pillBg: string; pillText: string }> = {
  'not-started': { label: 'Not Started', nodeColor: '#ffffff', nodeBorder: '#cccccc', nodeText: '#1a1a1a', dot: '#aaaaaa', pillBg: '#2a2a2a', pillText: '#888888' },
  'in-progress': { label: 'In Progress', nodeColor: '#7a7e1e', nodeBorder: '#9a9e2e', nodeText: '#ffffff', dot: '#c8cc3a', pillBg: '#2a2a10', pillText: '#c8cc3a' },
  'submitted':   { label: 'Submitted',   nodeColor: '#2e4dbb', nodeBorder: '#4a6ad4', nodeText: '#ffffff', dot: '#6a8af4', pillBg: '#131a3a', pillText: '#6a8af4' },
  'done':        { label: 'Done',        nodeColor: '#1e5c2e', nodeBorder: '#2e8c44', nodeText: '#ffffff', dot: '#4ade80', pillBg: '#0e2218', pillText: '#4ade80' },
  'revision':    { label: 'Need Revision', nodeColor: '#b84a00', nodeBorder: '#e06000', nodeText: '#ffffff', dot: '#f97316', pillBg: '#2a1500', pillText: '#f97316' },
  'late':        { label: 'Late',        nodeColor: '#b02020', nodeBorder: '#d43030', nodeText: '#ffffff', dot: '#f87171', pillBg: '#2a0e0e', pillText: '#f87171' },
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  red: { background: '#e84040', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 600, padding: '9px 18px', borderRadius: '5px', cursor: 'pointer' } as React.CSSProperties,
  ghost: { background: 'transparent', border: '1px solid #333', color: '#b0b0b0', fontSize: '13px', fontWeight: 500, padding: '9px 18px', borderRadius: '5px', cursor: 'pointer' } as React.CSSProperties,
  danger: { background: 'transparent', border: '1px solid #e84040', color: '#e84040', fontSize: '13px', fontWeight: 500, padding: '9px 18px', borderRadius: '5px', cursor: 'pointer' } as React.CSSProperties,
  label: { display: 'block', fontSize: '11px', fontWeight: 600, color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } as React.CSSProperties,
  input: { display: 'block', width: '100%', background: '#0e0e0e', border: '1px solid #333', color: '#f0f0f0', fontSize: '14px', padding: '10px 12px', borderRadius: '5px', marginBottom: '14px', boxSizing: 'border-box' } as React.CSSProperties,
}

// ─── Root app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('landing')
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  // Room state
  const [rooms, setRooms] = useState<Room[]>([])
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null)
  const [roomTab, setRoomTab] = useState<RoomTab>('flowchart')

  // Per-room derived data
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<(RoomMember & { user: User })[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)

  // UI state
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [chatInput, setChatInput] = useState('')
  const [showNotifs, setShowNotifs] = useState(false)
  const [showRoomMenu, setShowRoomMenu] = useState(false)
  const [authError, setAuthError] = useState('')

  // Modals
  const [mCreateRoom, setMCreateRoom] = useState(false)
  const [mJoinRoom, setMJoinRoom] = useState(false)
  const [mCreateTask, setMCreateTask] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [mTaskDetail, setMTaskDetail] = useState<Task | null>(null)
  const [mSubmitTask, setMSubmitTask] = useState<Task | null>(null)
  const [mDeleteRoom, setMDeleteRoom] = useState(false)

  const currentRoom = rooms.find(r => r.id === currentRoomId) ?? null
  const myRole: Role = currentRoom ? (memberDB.role(currentRoom.id, currentUser?.id ?? '') ?? 'member') : 'member'

  // ── Init ──

  useEffect(() => {
    migrateDB()
    initDB()
    userDB.logout()
    // Initialize Firebase sync (degrades gracefully if unavailable)
    waitForFirebase(3000).then((ok) => {
      if (ok) {
        initFirebaseSync()
      }
    })
    setReady(true)
  }, [])

  // ── Listen for Firestore-driven localStorage updates ──

  useEffect(() => {
    const handler = () => {
      loadRooms()
      if (currentRoomId) loadRoomData()
      if (currentUser) loadNotifs()
    }
    window.addEventListener('ontrack:sync', handler)
    return () => window.removeEventListener('ontrack:sync', handler)
  }, [currentRoomId, currentUser])

  // ── Load rooms whenever user changes or view goes to home ──

  const loadRooms = useCallback(() => {
    if (!currentUser) return
    setRooms(roomDB.forUser(currentUser.id))
  }, [currentUser])

  useEffect(() => { loadRooms() }, [loadRooms, view])

  // ── Load room data when currentRoomId changes ──

  const loadRoomData = useCallback(() => {
    if (!currentRoomId) return
    setTasks(taskDB.forRoom(currentRoomId))
    setMessages(messageDB.forRoom(currentRoomId))
    const rawMembers = memberDB.forRoom(currentRoomId)
    setMembers(rawMembers.map(m => ({ ...m, user: userDB.find(m.userId)! })).filter(m => m.user))
    taskDB.checkLate(currentRoomId)
  }, [currentRoomId])

  useEffect(() => { loadRoomData() }, [loadRoomData])

  // ── Load notifications for current user ──

  const loadNotifs = useCallback(() => {
    if (!currentUser) return
    const n = notifDB.forUser(currentUser.id)
    setNotifications(n)
    setUnread(n.filter(x => !x.read).length)
  }, [currentUser])

  useEffect(() => { loadNotifs() }, [loadNotifs, view, currentRoomId])

  // ── Auth actions ──

  function handleLogin(email: string, password: string) {
    const result = userDB.login(email, password)
    if (typeof result === 'string') { setAuthError(result); return }
    setCurrentUser(result)
    setRooms([])
    setCurrentRoomId(null)
    setRoomTab('flowchart')
    setStatusFilter('all')
    setShowNotifs(false)
    setShowRoomMenu(false)
    setAuthError('')
    setView('home')
  }

  function handleRegister(name: string, email: string, password: string) {
    const result = userDB.register(name, email, password)
    if (typeof result === 'string') { setAuthError(result); return }
    writeRow('users', result)
    setCurrentUser(result)
    setRooms([])
    setCurrentRoomId(null)
    setRoomTab('flowchart')
    setStatusFilter('all')
    setShowNotifs(false)
    setShowRoomMenu(false)
    setAuthError('')
    setView('home')
  }

  function handleLogout() {
    userDB.logout()
    setCurrentUser(null)
    setRooms([])
    setCurrentRoomId(null)
    setView('landing')
  }

  function handleSwitchAccount() {
    userDB.logout()
    setCurrentUser(null)
    setRooms([])
    setCurrentRoomId(null)
    setRoomTab('flowchart')
    setStatusFilter('all')
    setShowNotifs(false)
    setShowRoomMenu(false)
    setView('login')
  }

  // ── Navigation ──

  function goRoom(id: string, tab: RoomTab = 'flowchart') {
    const role = memberDB.role(id, currentUser?.id ?? '')
    const safeTab = tab === 'settings' && role !== 'leader' ? 'flowchart' : tab
    setCurrentRoomId(id)
    setView('room')
    setRoomTab(safeTab)
    setStatusFilter('all')
    setShowRoomMenu(false)
  }

  // ── Room actions ──

  function createRoom(title: string, description: string, color: string) {
    if (!currentUser) return
    const room = roomDB.insert({ title, description, leaderId: currentUser.id, color })
    writeRow('rooms', room)
    writeRow('room_members', { roomId: room.id, userId: currentUser.id, role: 'leader', joinedAt: now() })
    setMCreateRoom(false)
    loadRooms()
    goRoom(room.id)
  }

  function joinRoom(code: string) {
    if (!currentUser) { alert('You must be logged in to join a room.'); return }
    const normalizedCode = code.trim().toUpperCase()
    const result = roomDB.join(normalizedCode, currentUser.id)
    if (typeof result === 'string') { alert(result); return }
    const member = memberDB.find(result.id, currentUser.id)
    if (member) writeRow('room_members', member)
    setMJoinRoom(false)
    loadRooms()
    goRoom(result.id)
  }

  function archiveRoom(id: string) {
    roomDB.update(id, { archived: true })
    if (roomDB.find(id)) writeRow('rooms', roomDB.find(id)!)
    loadRooms()
    setView('home')
    setCurrentRoomId(null)
  }

  function unarchiveRoom(id: string) {
    roomDB.update(id, { archived: false })
    if (roomDB.find(id)) writeRow('rooms', roomDB.find(id)!)
    loadRooms()
  }

  function deleteRoom(id: string) {
    roomDB.delete(id)
    deleteRow('rooms', id)
    loadRooms()
    setView('home')
    setCurrentRoomId(null)
    setMDeleteRoom(false)
  }

  function updateRoom(id: string, data: { title?: string; description?: string }) {
    roomDB.update(id, data)
    const updated = roomDB.find(id)
    if (updated) writeRow('rooms', updated)
    loadRooms()
  }

  function leaveRoom(roomId: string) {
    if (!currentUser) return
    memberDB.delete(roomId, currentUser.id)
    deleteRow('room_members', `${roomId}:${currentUser.id}`)
    loadRooms()
    setView('home')
    setCurrentRoomId(null)
  }

  function removeMember(roomId: string, userId: string) {
    memberDB.delete(roomId, userId)
    deleteRow('room_members', `${roomId}:${userId}`)
    const tasks = taskDB.forRoom(roomId)
    tasks.forEach(task => {
      if (task.assigneeIds.includes(userId)) {
        const updated = taskDB.update(task.id, { assigneeIds: task.assigneeIds.filter(id => id !== userId) })
        if (updated) writeRow('tasks', updated)
      }
    })
    loadRoomData()
  }

  function autoArrange() {
    if (!currentRoom) return
    const allTasks = taskDB.forRoom(currentRoom.id)
    const taskDepsMap = Object.fromEntries(allTasks.map(t => [t.id, taskDB.deps(t.id)]))
    const layout = computeFlowchartLayout(allTasks, taskDepsMap)
    allTasks.forEach(t => {
      const pos = layout[t.id]
      if (pos) taskDB.update(t.id, { x: pos.x, y: pos.y })
    })
    loadRoomData()
  }

  // ── Task actions ──

  function createTask(data: Omit<Task, 'id' | 'createdAt'>, deps: string[]) {
    const task = taskDB.insert(data, deps)
    writeRow('tasks', task)
    syncTable('task_deps')
    setMCreateTask(false)
    autoArrange()
    loadNotifs()
  }

  function updateTask(id: string, data: Omit<Task, 'id' | 'createdAt'>, deps: string[]) {
    taskDB.update(id, data)
    taskDB.setDeps(id, deps)
    const updated = taskDB.forRoom(currentRoomId ?? '')
    updated.filter(t => t.id === id).forEach(t => writeRow('tasks', t))
    setEditingTask(null)
    loadRoomData()
    loadNotifs()
  }

  function submitTask(taskId: string, link: string) {
    if (!currentRoom) return
    taskDB.submit(taskId, link, currentRoom.leaderId)
    const updated = taskDB.forRoom(currentRoom.id).find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMSubmitTask(null)
    loadRoomData()
    loadNotifs()
  }

  function startTask(taskId: string) {
    taskDB.update(taskId, { status: 'in-progress' })
    const updated = taskDB.forRoom(currentRoomId ?? '').find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMTaskDetail(null)
    loadRoomData()
    loadNotifs()
  }

  function approveTask(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    taskDB.approve(taskId, task.assigneeIds)
    const updated = taskDB.forRoom(currentRoom?.id ?? '').find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMTaskDetail(null)
    loadRoomData()
    loadNotifs()
  }

  function requestRevision(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    taskDB.requestRevision(taskId, task.assigneeIds)
    const updated = taskDB.forRoom(currentRoom?.id ?? '').find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMTaskDetail(null)
    loadRoomData()
    loadNotifs()
  }

  function deleteTask(taskId: string) {
    taskDB.delete(taskId)
    deleteRow('tasks', taskId)
    syncTable('task_deps')
    setMTaskDetail(null)
    loadRoomData()
  }

  // ── Chat ──

  function sendMessage() {
    if (!chatInput.trim() || !currentRoomId || !currentUser) return
    const msg = messageDB.insert(currentRoomId, currentUser.id, chatInput)
    writeRow('messages', msg)
    setChatInput('')
    setMessages(messageDB.forRoom(currentRoomId))
  }

  // ── Profile ──

  function changePassword(current: string, next: string, confirm: string): string | null {
    if (!currentUser) return 'Not logged in.'
    if (currentUser.password !== current) return 'Current password is incorrect.'
    if (next.length < 6) return 'New password must be at least 6 characters.'
    if (next !== confirm) return 'Passwords do not match.'
    const updated = userDB.update(currentUser.id, { password: next })
    if (updated) writeRow('users', updated)
    return null
  }

  // ── Notifications ──

  function openNotifs() {
    setShowNotifs(v => !v)
    if (currentUser) {
      notifDB.markAllRead(currentUser.id)
      notifDB.forUser(currentUser.id).forEach(n => { if (n.read) writeRow('notifications', n) })
      loadNotifs()
    }
  }

  if (!ready) return null

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (view === 'landing') return <LandingPage onLogin={() => setView('login')} onRegister={() => setView('register')} />
  if (view === 'login')   return <AuthPage mode="login"    error={authError} onSubmit={handleLogin}   onSwitch={() => { setAuthError(''); setView('register') }} onBack={() => setView('landing')} />
  if (view === 'register') return <AuthPage mode="register" error={authError} onSubmit={handleRegister} onSwitch={() => { setAuthError(''); setView('login') }}    onBack={() => setView('landing')} />

  const activeRooms   = rooms.filter(r => !r.archived)
  const archivedRooms = rooms.filter(r => r.archived)

  return (
    <Shell
      view={view} setView={setView}
      currentRoom={currentRoom}
      currentUser={currentUser}
      activeRooms={activeRooms}
      roomTab={roomTab} setRoomTab={setRoomTab}
      notifications={notifications}
      unread={unread}
      showNotifs={showNotifs}
      onToggleNotifs={openNotifs}
      onRoomClick={goRoom}
    >
      {/* ━━━ HOME ━━━ */}
      {view === 'home' && (
        <div style={{ padding: '32px 40px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '28px' }}>
            <button style={S.red} onClick={() => setMCreateRoom(true)}>+ Create Room</button>
            <button style={S.ghost} onClick={() => setMJoinRoom(true)}>Join Room</button>
          </div>
          {activeRooms.length === 0
            ? <Empty text="No rooms yet. Create or join one to get started." />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {activeRooms.map(r => <RoomCard key={r.id} room={r} onClick={() => goRoom(r.id)} />)}
              </div>
          }
        </div>
      )}

      {/* ━━━ PROFILE ━━━ */}
      {view === 'profile' && currentUser && (
        <ProfileView user={currentUser} onLogout={handleLogout} onSwitchAccount={handleSwitchAccount} onChangePassword={changePassword} />
      )}

      {/* ━━━ ARCHIVED ━━━ */}
      {view === 'archived' && (
        <div style={{ padding: '32px 40px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '24px' }}>Archived Rooms</h2>
          {archivedRooms.length === 0
            ? <Empty text="No archived rooms." />
            : archivedRooms.map(r => (
              <div key={r.id} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '7px', padding: '18px 22px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '3px' }}>{r.title}</div>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '3px' }}>{r.description}</div>
                  <div style={{ fontSize: '12px', color: '#444' }}>Leader: {userDB.find(r.leaderId)?.name}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button style={{ ...S.ghost, fontSize: '12px', padding: '6px 12px' }} onClick={() => { unarchiveRoom(r.id) }}>Unarchive</button>
                  <button style={{ ...S.danger, fontSize: '12px', padding: '6px 12px' }} onClick={() => { if (confirm(`Delete "${r.title}"? This cannot be undone.`)) deleteRoom(r.id) }}>Delete</button>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* ━━━ ROOM ━━━ */}
      {view === 'room' && currentRoom && currentUser && (() => {
        const myTasks = tasks.filter(t => t.assigneeIds.includes(currentUser.id))
        const filteredTasks = myTasks.filter(t => statusFilter === 'all' || t.status === statusFilter)
        const taskDeps = Object.fromEntries(tasks.map(t => [t.id, taskDB.deps(t.id)]))
        const getUserName = (id: string) => userDB.find(id)?.name ?? id

        return (
          <>
            {/* Room header + tab bar */}
            <div style={{ borderBottom: '1px solid #1e1e1e', padding: '0 32px', background: '#111', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: '20px', paddingBottom: '4px' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 800 }}>{currentRoom.title}</div>
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>{currentRoom.description}</div>
                </div>
                {myRole === 'leader' && (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <button style={{ ...S.ghost, fontSize: '12px', padding: '6px 14px' }} onClick={() => setShowRoomMenu(v => !v)}>⋯</button>
                    {showRoomMenu && (
                      <div style={{ position: 'absolute', right: 0, top: '110%', background: '#191919', border: '1px solid #252525', borderRadius: '7px', minWidth: '170px', zIndex: 60, overflow: 'hidden' }}>
                        <DropItem label="Archive Room" onClick={() => { archiveRoom(currentRoom.id); setShowRoomMenu(false) }} />
                        <DropItem label="Delete Room" danger onClick={() => { setMDeleteRoom(true); setShowRoomMenu(false) }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex' }}>
                {(['flowchart', 'mytasks', 'chat', 'members', ...(myRole === 'leader' ? ['settings'] : [])] as RoomTab[]).map(t => (
                  <button key={t} onClick={() => setRoomTab(t)} style={{
                    background: 'none', border: 'none', padding: '10px 20px', fontSize: '13px',
                    cursor: 'pointer', fontWeight: roomTab === t ? 600 : 400,
                    color: roomTab === t ? '#f0f0f0' : '#555',
                    borderBottom: `2px solid ${roomTab === t ? '#e84040' : 'transparent'}`,
                    transition: 'color 0.15s',
                  }}>
                    {t === 'mytasks' ? 'My Tasks' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflow: 'auto' }}>

              {/* ── Flowchart ── */}
              {roomTab === 'flowchart' && (
                <div style={{ padding: '24px 32px' }}>
                   <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {(['all','not-started','in-progress','submitted','done','revision','late'] as const).map(s => (
                       <FilterPill key={s} statusKey={s} active={statusFilter === s} label={s === 'all' ? 'All' : STATUS[s as TaskStatus]?.label ?? s} onClick={() => setStatusFilter(s)} />
                     ))}
                     <button style={{ ...S.ghost, fontSize: '11px', padding: '5px 12px' }} onClick={autoArrange}>Auto Arrange</button>
                     {myRole === 'leader' && (
                       <button style={{ ...S.red, marginLeft: 'auto', fontSize: '12px', padding: '6px 14px' }} onClick={() => setMCreateTask(true)}>+ Add Task</button>
                     )}
                   </div>
                  {tasks.length === 0
                    ? <Empty text="No tasks yet. Add the first task to get started." />
                    : <FlowchartCanvas tasks={tasks} taskDeps={taskDeps} statusFilter={statusFilter} getUserName={getUserName} onTaskClick={setMTaskDetail} />
                  }
                </div>
              )}

              {/* ── My Tasks ── */}
              {roomTab === 'mytasks' && (
                <div style={{ padding: '24px 32px' }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    {(['all','not-started','in-progress','submitted','done','revision'] as const).map(s => (
                      <FilterPill key={s} statusKey={s} active={statusFilter === s} label={s === 'all' ? 'All' : STATUS[s as TaskStatus]?.label ?? s} onClick={() => setStatusFilter(s)} />
                    ))}
                  </div>
                  {filteredTasks.length === 0
                    ? <Empty text={myTasks.length === 0 ? 'No tasks assigned to you.' : 'No tasks match this filter.'} />
                    : filteredTasks.map(task => (
                      <div key={task.id} onClick={() => setMTaskDetail(task)} style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: '7px', padding: '16px 20px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#333')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = '#252525')}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{task.title}</div>
                          <div style={{ fontSize: '12px', color: '#555' }}>Due {task.deadline}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <StatusBadge status={task.status} />
                          {task.status === 'not-started' && (
                            <button style={{ ...S.ghost, fontSize: '12px', padding: '5px 12px' }}
                              onClick={e => { e.stopPropagation(); startTask(task.id) }}>Start</button>
                          )}
                          {(task.status === 'in-progress' || task.status === 'revision' || task.status === 'late') && (
                            <button style={{ ...S.red, fontSize: '12px', padding: '5px 12px' }}
                              onClick={e => { e.stopPropagation(); setMSubmitTask(task) }}>Submit</button>
                          )}
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}

              {/* ── Chat ── */}
              {roomTab === 'chat' && (
                <ChatView
                  messages={messages}
                  currentUserId={currentUser.id}
                  getUserName={getUserName}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  onSend={sendMessage}
                />
              )}

              {/* ── Members ── */}
              {roomTab === 'members' && (
                <div style={{ padding: '24px 32px' }}>
                  {myRole === 'leader' && (
                    <div style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: '7px', padding: '14px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Join Code</span>
                      <code style={{ fontFamily: "'DM Mono', monospace", fontSize: '17px', fontWeight: 700, letterSpacing: '0.15em', color: '#f0f0f0' }}>{currentRoom.code}</code>
                      <button style={{ ...S.ghost, fontSize: '11px', padding: '4px 10px', marginLeft: 'auto' }}
                        onClick={() => navigator.clipboard?.writeText(currentRoom.code)}>Copy</button>
                    </div>
                  )}
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                     {members.map(m => (
                       <div key={m.userId} style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: '7px', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                           <Avatar name={m.user.name} color={m.role === 'leader' ? '#e84040' : '#2a2a2a'} />
                           <div>
                             <div style={{ fontWeight: 500 }}>{m.user.name}</div>
                             <div style={{ fontSize: '12px', color: '#555' }}>{m.user.email}</div>
                           </div>
                         </div>
                         <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                           <span style={{ fontSize: '11px', fontWeight: 700, color: m.role === 'leader' ? '#e84040' : '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.role}</span>
                           {myRole === 'leader' && m.role !== 'leader' && (
                             <button style={{ ...S.danger, fontSize: '11px', padding: '4px 10px' }} onClick={() => { if (confirm(`Remove ${m.user.name}?`)) removeMember(currentRoom.id, m.userId) }}>Remove</button>
                           )}
                         </div>
                       </div>
                     ))}
                   </div>
                   {myRole === 'member' && (
                     <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #252525' }}>
                       <button style={{ ...S.danger, width: '100%' }} onClick={() => { if (confirm('Leave this room?')) leaveRoom(currentRoom.id) }}>Leave Room</button>
                     </div>
                   )}
                 </div>
               )}

              {/* ── Settings — leaders only ── */}
              {roomTab === 'settings' && myRole === 'leader' && (
                <SettingsView
                  room={currentRoom}
                  myRole={myRole}
                  onUpdate={(data) => updateRoom(currentRoom.id, data)}
                  onArchive={() => archiveRoom(currentRoom.id)}
                  onDelete={() => setMDeleteRoom(true)}
                  onLeave={() => leaveRoom(currentRoom.id)}
                />
              )}
            </div>

            {/* ── Task Detail Modal ── */}
            {mTaskDetail && (
              <Modal title="Task Details" onClose={() => setMTaskDetail(null)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, flex: 1, paddingRight: '12px' }}>{mTaskDetail.title}</h3>
                  <StatusBadge status={mTaskDetail.status} />
                </div>
                <p style={{ color: '#888', fontSize: '14px', lineHeight: 1.6, marginBottom: '18px' }}>{mTaskDetail.description}</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                  <InfoBox label="Assignees" value={mTaskDetail.assigneeIds.length ? mTaskDetail.assigneeIds.map(id => getUserName(id)).join(', ') : 'Unassigned'} />
                  <InfoBox label="Deadline" value={mTaskDetail.deadline} />
                </div>
                {mTaskDetail.submissionLink && (
                  <div style={{ marginBottom: '14px' }}>
                    <InfoBox label="Submission Link" value={<a href={mTaskDetail.submissionLink} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontSize: '13px', wordBreak: 'break-all' }}>{mTaskDetail.submissionLink}</a>} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {myRole === 'leader' && mTaskDetail.status === 'submitted' && (
                    <>
                      <button style={{ ...S.red, flex: 1 }} onClick={() => approveTask(mTaskDetail.id)}>✓ Approve</button>
                      <button style={{ ...S.danger, flex: 1 }} onClick={() => requestRevision(mTaskDetail.id)}>↩ Request Revision</button>
                    </>
                  )}
                  {mTaskDetail.assigneeIds.includes(currentUser.id) && mTaskDetail.status === 'not-started' && (
                    <button style={{ ...S.red, flex: 1 }} onClick={() => startTask(mTaskDetail.id)}>Start Task</button>
                  )}
                  {mTaskDetail.assigneeIds.includes(currentUser.id) && (mTaskDetail.status === 'in-progress' || mTaskDetail.status === 'revision' || mTaskDetail.status === 'late') && (
                    <button style={{ ...S.red, flex: 1 }} onClick={() => { setMTaskDetail(null); setMSubmitTask(mTaskDetail) }}>Submit Task</button>
                  )}
                  {myRole === 'leader' && mTaskDetail.status !== 'submitted' && mTaskDetail.status !== 'done' && (
                    <button style={{ ...S.ghost, fontSize: '12px', padding: '7px 12px' }} onClick={() => { setEditingTask(mTaskDetail); setMTaskDetail(null) }}>Edit Task</button>
                  )}
                </div>
              </Modal>
            )}

            {/* ── Create/Edit Task Modal ── */}
            {(mCreateTask || editingTask) && myRole === 'leader' && (
              <CreateTaskModal
                roomId={currentRoom.id}
                members={members}
                existingTasks={tasks}
                taskDeps={taskDeps}
                task={editingTask ?? undefined}
                onClose={() => { setMCreateTask(false); setEditingTask(null) }}
                onSave={editingTask ? (data, deps) => updateTask(editingTask.id, data, deps) : createTask}
                onDelete={() => { setEditingTask(null); loadRoomData() }}
              />
            )}

            {/* ── Submit Task Modal ── */}
            {mSubmitTask && (
              <SubmitTaskModal
                task={mSubmitTask}
                onClose={() => setMSubmitTask(null)}
                onSubmit={(link) => submitTask(mSubmitTask.id, link)}
              />
            )}

            {/* ── Delete Room Confirm ── */}
            {mDeleteRoom && (
              <Modal title="Delete Room" onClose={() => setMDeleteRoom(false)}>
                <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px', lineHeight: 1.6 }}>
                  Are you sure you want to permanently delete <strong style={{ color: '#f0f0f0' }}>{currentRoom.title}</strong>? This will remove all tasks, members, and messages. This action cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button style={{ ...S.danger, flex: 1 }} onClick={() => deleteRoom(currentRoom.id)}>Delete Room</button>
                  <button style={{ ...S.ghost, flex: 1 }} onClick={() => setMDeleteRoom(false)}>Cancel</button>
                </div>
              </Modal>
            )}
          </>
        )
      })()}

      {/* ── Global modals ── */}
      {mCreateRoom && (
        <CreateRoomModal
          roomCount={rooms.length}
          onClose={() => setMCreateRoom(false)}
          onSave={createRoom}
        />
      )}
      {mJoinRoom && (
        <JoinRoomModal onClose={() => setMJoinRoom(false)} onJoin={joinRoom} />
      )}
    </Shell>
  )
}

// ─── Shell ─────────────────────────────────────────────────────────────────────

function Shell({ children, view, setView, currentRoom, currentUser, activeRooms, roomTab, setRoomTab, notifications, unread, showNotifs, onToggleNotifs, onRoomClick }: {
  children: React.ReactNode; view: View; setView: (v: View) => void
  currentRoom: Room | null; currentUser: User | null; activeRooms: Room[]
  roomTab: RoomTab; setRoomTab: (t: RoomTab) => void
  notifications: Notification[]; unread: number
  showNotifs: boolean; onToggleNotifs: () => void
  onRoomClick: (id: string) => void
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#111', color: '#f0f0f0', fontFamily: 'Inter, sans-serif' }}>
      {/* Top nav */}
      <header style={{ height: '50px', background: '#0d0d0d', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => setView('home')} style={{ fontFamily: "'DM Mono', monospace", fontSize: '14px', fontWeight: 700, letterSpacing: '0.18em', color: '#f0f0f0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>ONTRACK</button>
          {view === 'room' && currentRoom && <span style={{ fontSize: '12px', color: '#3a3a3a' }}>/ {currentRoom.title}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ position: 'relative' }}>
            <button onClick={onToggleNotifs} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', color: '#666', fontSize: '15px', position: 'relative' }}>
              🔔
              {unread > 0 && <span style={{ position: 'absolute', top: '2px', right: '4px', minWidth: '16px', height: '16px', background: '#e84040', borderRadius: '8px', border: '2px solid #0d0d0d', fontSize: '10px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{unread > 9 ? '9+' : unread}</span>}
            </button>
            {showNotifs && (
              <div style={{ position: 'absolute', right: 0, top: '110%', background: '#191919', border: '1px solid #252525', borderRadius: '9px', width: '320px', zIndex: 200, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #222', fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Notifications</div>
                {notifications.length === 0
                  ? <div style={{ padding: '20px 16px', color: '#555', fontSize: '13px', textAlign: 'center' }}>All caught up!</div>
                  : notifications.slice(0, 8).map(n => (
                    <div key={n.id} style={{ padding: '12px 16px', fontSize: '13px', color: n.read ? '#666' : '#bbb', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '10px' }}>
                      <span style={{ color: n.read ? '#333' : '#e84040', flexShrink: 0, marginTop: '1px' }}>●</span>
                      <div style={{ flex: 1 }}>
                        <div>{n.text}</div>
                        <div style={{ fontSize: '11px', color: '#444', marginTop: '3px' }}>{relativeTime(n.createdAt)}</div>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
          {currentUser && (
             <button onClick={() => setView('profile')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', color: '#aaa', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser.name}</span>
             </button>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <aside style={{ width: '210px', background: '#f2f2f2', borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ padding: '14px 10px' }}>
            {view === 'room' && currentRoom && (() => {
              const role = memberDB.role(currentRoom.id, currentUser?.id ?? '')
              const tabs = (['flowchart','mytasks','chat','members',...(role === 'leader' ? ['settings'] : [])] as RoomTab[])
              return (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 8px', marginBottom: '6px' }}>Navigation</div>
                {tabs.map(t => (
                  <SidebarBtn key={t} label={t === 'mytasks' ? 'My Tasks' : t.charAt(0).toUpperCase() + t.slice(1)} active={roomTab === t} onClick={() => setRoomTab(t)} />
                ))}
                <Divider />
              </>
              )
            })()}
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 8px', marginBottom: '6px' }}>Rooms</div>
            {activeRooms.length === 0
              ? <div style={{ padding: '8px 10px', fontSize: '12px', color: '#aaa' }}>No rooms yet.</div>
              : activeRooms.map(r => (
                <button key={r.id} onClick={() => onRoomClick(r.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px 8px 11px',
                  background: currentRoom?.id === r.id ? '#e4e4e4' : 'transparent',
                  border: 'none', borderRadius: '5px', fontSize: '13px', color: '#333',
                  cursor: 'pointer', marginBottom: '2px',
                  borderLeft: `3px solid ${r.color}`,
                  fontFamily: 'Inter, sans-serif', fontWeight: currentRoom?.id === r.id ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{r.title}</button>
              ))
            }
            <Divider />
            <SidebarBtn label="Archived" active={view === 'archived'} onClick={() => setView('archived')} dim />
            <SidebarBtn label="Profile"  active={view === 'profile'}  onClick={() => setView('profile')}  dim />
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  )
}

// ─── Landing page ──────────────────────────────────────────────────────────────

function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', position: 'relative', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="none">
        <ellipse cx="25%" cy="55%" rx="48%" ry="38%" fill="none" stroke="#1c1c1c" strokeWidth="1.5" transform="rotate(-12,400,400)" />
        <ellipse cx="72%" cy="35%" rx="38%" ry="30%" fill="none" stroke="#1a1a1a" strokeWidth="1" transform="rotate(8,700,300)" />
        <ellipse cx="55%" cy="75%" rx="55%" ry="22%" fill="none" stroke="#181818" strokeWidth="1" transform="rotate(-3,600,500)" />
        <ellipse cx="80%" cy="62%" rx="28%" ry="42%" fill="none" stroke="#191919" strokeWidth="1.5" transform="rotate(18,800,500)" />
        <ellipse cx="15%" cy="25%" rx="22%" ry="35%" fill="none" stroke="#181818" strokeWidth="1" transform="rotate(-25,200,200)" />
      </svg>
      <nav style={{ position: 'relative', zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 48px', borderBottom: '1px solid #171717' }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '15px', fontWeight: 700, letterSpacing: '0.18em', color: '#f0f0f0' }}>ONTRACK</span>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={onLogin} style={{ background: 'none', border: 'none', color: '#888', fontSize: '13px', cursor: 'pointer', padding: '8px 14px' }}>Log in</button>
          <button onClick={onRegister} style={{ ...S.red, fontSize: '13px' }}>Register Now</button>
        </div>
      </nav>
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 58px)', textAlign: 'center', padding: '0 24px' }}>
        <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.2em', color: '#444', marginBottom: '24px' }}>STUDENT PROJECT MANAGEMENT</div>
        <h1 style={{ fontSize: 'clamp(36px, 7vw, 72px)', fontWeight: 800, color: '#f0f0f0', letterSpacing: '-0.03em', lineHeight: 1.05, marginBottom: '22px' }}>
          WELCOME TO <span style={{ color: '#e84040' }}>ONTRACK</span>
        </h1>
        <p style={{ fontSize: '16px', color: '#666', maxWidth: '380px', lineHeight: 1.7, marginBottom: '40px' }}>Track tasks. Visualize progress. Hit every deadline.</p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onRegister} style={{ ...S.red, fontSize: '15px', padding: '13px 36px' }}>Get Started</button>
          <button onClick={onLogin} style={{ ...S.ghost, fontSize: '15px', padding: '13px 36px' }}>Log in</button>
        </div>
        <div style={{ marginTop: '70px', display: 'flex', gap: '40px', color: '#444', fontSize: '13px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {['Flowchart Visualization','Role-Based Access','Real-Time Tracking','Group Chat'].map(f => (
            <span key={f} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ color: '#e84040' }}>✓</span>{f}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Auth page ─────────────────────────────────────────────────────────────────

type AuthSubmit = ((email: string, password: string) => void) | ((name: string, email: string, password: string) => void)

function AuthPage({ mode, error, onSubmit, onSwitch, onBack }: { mode: 'login' | 'register'; error: string; onSubmit: AuthSubmit; onSwitch: () => void; onBack: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showFullTerms, setShowFullTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const isLogin = mode === 'login'

  function handleSubmit() {
    if (isLogin) (onSubmit as (e: string, p: string) => void)(email, password)
    else {
      if (!termsAccepted) {
        alert('You must agree to the Terms and Agreement to create an account.')
        return
      }
      (onSubmit as (n: string, e: string, p: string) => void)(name, email, password)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', position: 'relative', overflow: 'hidden', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }} preserveAspectRatio="none">
        <ellipse cx="30%" cy="65%" rx="50%" ry="35%" fill="none" stroke="#1e1e1e" strokeWidth="1.5" transform="rotate(-10,400,450)" />
        <ellipse cx="75%" cy="30%" rx="35%" ry="28%" fill="none" stroke="#191919" strokeWidth="1" transform="rotate(12,700,250)" />
      </svg>
      <nav style={{ position: 'relative', zIndex: 10, padding: '18px 48px', borderBottom: '1px solid #171717' }}>
        <button onClick={onBack} style={{ fontFamily: "'DM Mono', monospace", fontSize: '15px', fontWeight: 700, letterSpacing: '0.18em', color: '#f0f0f0', background: 'none', border: 'none', cursor: 'pointer' }}>ONTRACK</button>
      </nav>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 20px', position: 'relative', zIndex: 10 }}>
        <div style={{ background: '#131313', border: '1px solid #222', borderRadius: '10px', padding: '40px', width: '100%', maxWidth: '380px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px', textAlign: 'center' }}>{isLogin ? 'Log in' : 'Create account'}</h2>
          <p style={{ fontSize: '13px', color: '#555', textAlign: 'center', marginBottom: '28px' }}>{isLogin ? 'Welcome back to ONTRACK' : 'Join your team on ONTRACK'}</p>
          {error && <div style={{ background: '#2a1515', border: '1px solid #5a2020', borderRadius: '5px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#e84040' }}>{error}</div>}
          {!isLogin && (
            <div>
              <label style={S.label}>Full Name</label>
              <input style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
            </div>
          )}
          <label style={S.label}>Email</label>
          <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@university.edu" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          <label style={S.label}>Password</label>
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
              )}
            </button>
          </div>
          {!isLogin && (
            <div>
              <label style={S.label}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showConfirm ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {showConfirm ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
                  )}
                </button>
              </div>
            </div>
          )}
          {!isLogin && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ background: '#111', border: '1px solid #252525', borderRadius: '7px', padding: '14px', fontSize: '12px', color: '#888', lineHeight: 1.6, maxHeight: showFullTerms ? 'none' : '120px', overflow: 'hidden' }}>
                <strong style={{ color: '#ccc' }}>OnTrack Terms and Agreement</strong>
                <br /><br />
                <strong>1. Purpose of the System</strong><br />
                OnTrack is a task and deadline monitoring system developed as a capstone project for academic use by student groups at Bataan Peninsula State University. It is intended to help manage capstone, thesis, and other collaborative group projects.
                <br /><br />
                <strong>2. Account Responsibility</strong><br />
                You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You agree to provide accurate and truthful information during registration.
                <br /><br />
                <strong>3. Acceptable Use</strong><br />
                You agree to use OnTrack only for legitimate academic project management purposes. You will not use the system to post harmful, offensive, or misleading content in project rooms, task descriptions, or group chat.
                {showFullTerms && (
                  <>
                    <br /><br />
                    <strong>4. Content and Submissions</strong><br />
                    Any task submissions made through OnTrack are done via links to externally hosted content (e.g., Google Drive, GitHub, Figma). You are responsible for ensuring that content you link to is accessible to your project room's members and does not violate any third-party rights.
                    <br /><br />
                    <strong>5. Data Usage</strong><br />
                    Information you provide (name, email, project data, messages) will be used solely to operate the OnTrack system for its intended academic purpose. As a student capstone project, OnTrack does not sell or share your data with third parties.
                    <br /><br />
                    <strong>6. Room Leadership and Access</strong><br />
                    Project leaders have administrative control over their rooms, including the ability to assign tasks, review submissions, remove members, and archive or delete rooms. Members acknowledge that leaders may take these actions as part of normal project management.
                    <br /><br />
                    <strong>7. Availability</strong><br />
                    OnTrack is provided as an academic prototype/capstone system. It is provided "as is," and the developers do not guarantee uninterrupted availability or data retention beyond the scope of the course/project period.
                    <br /><br />
                    <strong>8. Changes to Terms</strong><br />
                    These terms may be updated as the system evolves during development. Continued use of OnTrack after changes constitutes acceptance of the updated terms.
                  </>
                )}
              </div>
              <div style={{ textAlign: 'right', marginTop: '6px' }}>
                <span onClick={() => setShowFullTerms(v => !v)} style={{ fontSize: '11px', color: '#e84040', cursor: 'pointer', fontWeight: 500 }}>
                  {showFullTerms ? 'Show less' : 'Read more'}
                </span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} />
                <span style={{ fontSize: '12px', color: '#888' }}>I agree to the Terms and Agreement</span>
              </label>
            </div>
          )}
          {isLogin && <div style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '14px' }}><span style={{ fontSize: '12px', color: '#555', cursor: 'pointer' }}>Forgot password?</span></div>}
          <button onClick={handleSubmit} style={{ ...S.red, width: '100%', padding: '12px', fontSize: '14px' }}>{isLogin ? 'Log in' : 'Register'}</button>
          {!isLogin && <p style={{ fontSize: '11px', color: '#444', textAlign: 'center', marginTop: '12px' }}>Demo: log in as <strong style={{ color: '#666' }}>alex@uni.edu</strong> / <strong style={{ color: '#666' }}>password</strong></p>}
          <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#555' }}>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <span onClick={onSwitch} style={{ color: '#e84040', cursor: 'pointer', fontWeight: 500 }}>{isLogin ? 'Register' : 'Log in'}</span>
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Profile view ──────────────────────────────────────────────────────────────

function ProfileView({ user, onLogout, onSwitchAccount, onChangePassword }: { user: User; onLogout: () => void; onSwitchAccount: () => void; onChangePassword: (c: string, n: string, co: string) => string | null }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [showConfirmNew, setShowConfirmNew] = useState(false)

  function save() {
    const err = onChangePassword(current, next, confirm)
    if (err) setMsg({ text: err, ok: false })
    else { setMsg({ text: 'Password updated successfully.', ok: true }); setCurrent(''); setNext(''); setConfirm('') }
  }

  return (
    <div style={{ padding: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <Avatar name={user.name} size={56} color="#2563eb" />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{user.name}</div>
          <div style={{ fontSize: '13px', color: '#666' }}>{user.email}</div>
        </div>
      </div>
      <div style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: '8px', padding: '24px', maxWidth: '440px', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '18px', color: '#e0e0e0' }}>Change Password</h3>
        {msg && <div style={{ background: msg.ok ? '#163326' : '#2a1515', border: `1px solid ${msg.ok ? '#22c55e30' : '#e8404030'}`, borderRadius: '5px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: msg.ok ? '#4ade80' : '#e84040' }}>{msg.text}</div>}
        <label style={S.label}>Current Password</label>
        <div style={{ position: 'relative', marginBottom: '14px' }}>
          <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showCurrent ? "text" : "password"} value={current} onChange={e => setCurrent(e.target.value)} placeholder="••••••••" />
          <button type="button" onClick={() => setShowCurrent(!showCurrent)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {showCurrent ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
            )}
          </button>
        </div>
        <label style={S.label}>New Password</label>
        <div style={{ position: 'relative', marginBottom: '14px' }}>
          <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showNext ? "text" : "password"} value={next} onChange={e => setNext(e.target.value)} placeholder="Min. 6 characters" />
          <button type="button" onClick={() => setShowNext(!showNext)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {showNext ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
            )}
          </button>
        </div>
        <label style={S.label}>Confirm New Password</label>
        <div style={{ position: 'relative' }}>
          <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showConfirmNew ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
          <button type="button" onClick={() => setShowConfirmNew(!showConfirmNew)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {showConfirmNew ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
            )}
          </button>
        </div>
        <button style={S.red} onClick={save}>Save Changes</button>
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button style={S.ghost} onClick={onSwitchAccount}>Switch Account</button>
        <button style={S.danger} onClick={onLogout}>Logout</button>
      </div>
    </div>
  )
}

// ─── Settings view ─────────────────────────────────────────────────────────────

function SettingsView({ room, myRole, onUpdate, onArchive, onDelete, onLeave }: { room: Room; myRole: Role; onUpdate: (d: { title?: string; description?: string }) => void; onArchive: () => void; onDelete: () => void; onLeave: () => void }) {
  const [title, setTitle] = useState(room.title)
  const [desc, setDesc] = useState(room.description)
  const [saved, setSaved] = useState(false)

  function save() { onUpdate({ title, description: desc }); setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: '8px', padding: '24px', maxWidth: '500px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '18px', color: '#e0e0e0' }}>Room Settings</h3>
        <label style={S.label}>Project Title</label>
        <input style={S.input} value={title} onChange={e => setTitle(e.target.value)} />
        <label style={S.label}>Description</label>
        <textarea style={{ ...S.input, height: '80px', resize: 'none' }} value={desc} onChange={e => setDesc(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button style={S.red} onClick={save}>Save Changes</button>
          {saved && <span style={{ fontSize: '13px', color: '#4ade80' }}>✓ Saved</span>}
        </div>
      </div>
      {myRole === 'leader' && (
        <div style={{ display: 'flex', gap: '10px', maxWidth: '500px', flexWrap: 'wrap' }}>
          <button style={S.ghost} onClick={onArchive}>Archive Room</button>
          <button style={S.danger} onClick={onDelete}>Delete Room</button>
        </div>
      )}
      {myRole === 'member' && (
        <button style={S.danger} onClick={() => { if (confirm('Leave this room?')) onLeave() }}>Leave Room</button>
      )}
    </div>
  )
}

// ─── Flowchart layout ──────────────────────────────────────────────────────────

function computeFlowchartLayout(tasks: Task[], taskDeps: Record<string, string[]>): Record<string, { x: number; y: number }> {
  const nodeW = 170
  const nodeH = 50
  const hGap = 40
  const vGap = 80
  const startX = 80
  const startY = 50

  if (tasks.length === 0) return {}

  const taskMap = new Map(tasks.map(t => [t.id, t]))

  const deps: Record<string, string[]> = {}
  tasks.forEach(t => {
    deps[t.id] = (taskDeps[t.id] ?? []).filter(id => taskMap.has(id))
  })

  const memo = new Map<string, number>()
  const getLevel = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!
    const maxParent = deps[id].reduce((m, p) => Math.max(m, getLevel(p)), -1)
    const lvl = maxParent + 1
    memo.set(id, lvl)
    return lvl
  }
  tasks.forEach(t => getLevel(t.id))

  const groups = new Map<number, Task[]>()
  tasks.forEach(t => {
    const lvl = memo.get(t.id) ?? 0
    if (!groups.has(lvl)) groups.set(lvl, [])
    groups.get(lvl)!.push(t)
  })

  const levels = Array.from(groups.keys()).sort((a, b) => a - b)

  const positions = new Map<string, { x: number; y: number }>()

  levels.forEach(lvl => {
    const group = groups.get(lvl)!
    const y = startY + lvl * (nodeH + vGap)

    if (lvl === 0) {
      const totalWidth = group.length * nodeW + (group.length - 1) * hGap
      let x = startX + Math.max(0, (900 - totalWidth) / 2)
      group.forEach(t => {
        positions.set(t.id, { x, y })
        x += nodeW + hGap
      })
    } else {
      const items = group.map(t => {
        const parentIds = deps[t.id]
        if (parentIds.length === 0) return { id: t.id, idealX: startX }
        const parentXs = parentIds.map(pid => positions.get(pid)!.x + nodeW / 2)
        const avgX = parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length
        return { id: t.id, idealX: avgX - nodeW / 2 }
      })

      items.sort((a, b) => a.idealX - b.idealX)

      // Center the group under the average parent center
      const groupWidth = group.length * nodeW + (group.length - 1) * hGap
      const groupCenterX = items.reduce((sum, item) => sum + item.idealX + nodeW / 2, 0) / group.length
      let currentX = Math.max(startX, groupCenterX - groupWidth / 2)

      items.forEach((item, i) => {
        if (i > 0) {
          const prevX = positions.get(items[i - 1].id)!.x
          const minX = prevX + nodeW + hGap
          if (currentX < minX) currentX = minX
        }
        positions.set(item.id, { x: currentX, y })
        currentX += nodeW + hGap
      })
    }
  })

  return Object.fromEntries(positions)
}

// ─── Flowchart canvas ──────────────────────────────────────────────────────────

function FlowchartCanvas({ tasks, taskDeps, statusFilter, getUserName, onTaskClick }: { tasks: Task[]; taskDeps: Record<string, string[]>; statusFilter: string; getUserName: (id: string) => string; onTaskClick: (t: Task) => void }) {
  const nodeW = 170; const nodeH = 50
  const pad = 50
  const canvasW = Math.max(...tasks.map(t => t.x + nodeW + pad), 860)
  const canvasH = Math.max(...tasks.map(t => t.y + nodeH + pad), 520)
  const idMap = Object.fromEntries(tasks.map(t => [t.id, t]))

  const edges = tasks.flatMap(task =>
    (taskDeps[task.id] ?? []).map(depId => {
      const dep = idMap[depId]
      if (!dep) return null
      return { x1: dep.x + nodeW / 2, y1: dep.y + nodeH, x2: task.x + nodeW / 2, y2: task.y, key: `${depId}-${task.id}` }
    }).filter(Boolean)
  )

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'auto' }}>
      <div style={{ position: 'relative', width: canvasW, height: canvasH, minHeight: 500 }}>
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width={canvasW} height={canvasH}>
          <defs>
            <marker id="arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill="#555" />
            </marker>
          </defs>
          {edges.map((e: any) => {
            const cy = (e.y1 + e.y2) / 2
            return <path key={e.key} d={`M ${e.x1} ${e.y1} C ${e.x1} ${cy}, ${e.x2} ${cy}, ${e.x2} ${e.y2}`} fill="none" stroke="#555" strokeWidth="1.5" markerEnd="url(#arr)" />
          })}
        </svg>
        {tasks.map(task => {
          const cfg = STATUS[task.status]
          const visible = statusFilter === 'all' || task.status === statusFilter
          return (
            <div key={task.id} onClick={() => onTaskClick(task)} style={{
              position: 'absolute', left: task.x, top: task.y, width: nodeW, minHeight: nodeH,
              background: visible ? cfg.nodeColor : '#222',
              border: `2px solid ${visible ? cfg.nodeBorder : '#333'}`,
              borderRadius: '10px', padding: '10px 14px', cursor: 'pointer',
              opacity: visible ? 1 : 0.18,
              transition: 'opacity 0.2s, transform 0.15s, box-shadow 0.15s',
              boxShadow: visible ? `0 2px 8px rgba(0,0,0,0.35)` : 'none',
            }}
              onMouseEnter={e => { if (visible) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.5)' } }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = visible ? '0 2px 8px rgba(0,0,0,0.35)' : 'none' }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: visible ? cfg.nodeText : '#555', lineHeight: 1.3, marginBottom: '3px' }}>{task.title}</div>
              <div style={{ fontSize: '10px', color: visible ? (cfg.nodeColor === '#ffffff' ? '#777' : `${cfg.nodeText}99`) : '#444' }}>
                {task.assigneeIds.length ? task.assigneeIds.map(id => getUserName(id)).join(', ') : 'Unassigned'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Chat view ─────────────────────────────────────────────────────────────────

function ChatView({ messages, currentUserId, getUserName, chatInput, setChatInput, onSend }: { messages: Message[]; currentUserId: string; getUserName: (id: string) => string; chatInput: string; setChatInput: (v: string) => void; onSend: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 168px)', minHeight: '400px' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {messages.map(m => {
          const mine = m.senderId === currentUserId
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', gap: '10px', alignItems: 'flex-end' }}>
              {!mine && <Avatar name={getUserName(m.senderId)} size={32} color="#1e1e1e" />}
              <div style={{ maxWidth: '58%' }}>
                {!mine && <div style={{ fontSize: '11px', color: '#555', marginBottom: '4px' }}>{getUserName(m.senderId)}</div>}
                <div style={{ background: mine ? '#1d4ed8' : '#1e1e1e', padding: '10px 14px', borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px', fontSize: '14px', color: '#f0f0f0', lineHeight: 1.5 }}>{m.text}</div>
                <div style={{ fontSize: '10px', color: '#444', marginTop: '3px', textAlign: mine ? 'right' : 'left' }}>{fmtTime(m.createdAt)}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: '14px 32px', borderTop: '1px solid #1e1e1e', display: 'flex', gap: '10px' }}>
        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSend()} style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder="Type a message…" />
        <button onClick={onSend} style={{ ...S.red, padding: '10px 18px' }}>Send</button>
      </div>
    </div>
  )
}

// ─── Modals ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#161616', border: '1px solid #252525', borderRadius: '10px', padding: '28px', width: '100%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.7)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: '18px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function CreateRoomModal({ roomCount, onClose, onSave }: { roomCount: number; onClose: () => void; onSave: (title: string, desc: string, color: string) => void }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [color, setColor] = useState(ROOM_COLORS[roomCount % ROOM_COLORS.length])
  return (
    <Modal title="Create Room" onClose={onClose}>
      <label style={S.label}>Project Title</label>
      <input style={S.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Capstone Project 2025" autoFocus />
      <label style={S.label}>Description</label>
      <textarea style={{ ...S.input, height: '80px', resize: 'none' }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Briefly describe the project goal" />
      <label style={S.label}>Room Color</label>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {ROOM_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)} style={{ width: '32px', height: '32px', borderRadius: '50%', background: c, border: `2px solid ${color === c ? '#fff' : 'transparent'}`, cursor: 'pointer', padding: 0, outline: 'none' }} />
        ))}
      </div>
      <button style={{ ...S.red, width: '100%' }} onClick={() => { if (!title.trim()) return; onSave(title, desc, color) }}>Create Room</button>
    </Modal>
  )
}

function JoinRoomModal({ onClose, onJoin }: { onClose: () => void; onJoin: (code: string) => void }) {
  const [code, setCode] = useState('')
  return (
    <Modal title="Join Room" onClose={onClose}>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>Ask your team leader for the room code.</p>
      <label style={S.label}>Room Code</label>
      <input style={S.input} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. CAP001" maxLength={8} autoFocus onKeyDown={e => e.key === 'Enter' && code.trim() && onJoin(code)} />
      <button style={{ ...S.red, width: '100%' }} onClick={() => { if (!code.trim()) return; onJoin(code) }}>Join Room</button>
    </Modal>
  )
}

function CreateTaskModal({ roomId, members, existingTasks, taskDeps, task, onClose, onSave, onDelete }: { roomId: string; members: (RoomMember & { user: User })[]; existingTasks: Task[]; taskDeps: Record<string, string[]>; task?: Task; onClose: () => void; onSave: (data: Omit<Task, 'id' | 'createdAt'>, deps: string[]) => void; onDelete?: () => void }) {
  const isEditing = !!task
  const [title, setTitle] = useState(task?.title ?? '')
  const [desc, setDesc] = useState(task?.description ?? '')
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assigneeIds ?? [])
  const [deadline, setDeadline] = useState(task?.deadline ?? '')
  const [deps, setDeps] = useState<string[]>([])
  const [deadlineError, setDeadlineError] = useState('')

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDesc(task.description)
      setAssigneeIds(task.assigneeIds)
      setDeadline(task.deadline)
      setDeps(taskDeps[task.id] ?? [])
    }
  }, [task, taskDeps])

  function validateDeadline(value: string) {
    if (!value) { setDeadlineError(''); return }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const selected = new Date(value)
    if (selected < today) {
      setDeadlineError('Deadline cannot be in the past.')
    } else {
      setDeadlineError('')
    }
  }

  function handleDeadlineChange(value: string) {
    setDeadline(value)
    validateDeadline(value)
  }

  function save() {
    if (!title.trim()) return
    validateDeadline(deadline)
    if (deadlineError) return
    let x: number, y: number
    if (task) {
      x = task.x
      y = task.y
    } else {
      const nodeH = 50
      const vGap = 40
      const minY = existingTasks.reduce((max, t) => Math.max(max, t.y + nodeH), 60)
      x = 100
      y = minY > 60 ? minY + vGap : 60
    }
    const data = {
      roomId,
      title: title.trim(),
      description: desc.trim(),
      assigneeIds,
      deadline,
      status: task?.status ?? 'not-started',
      x,
      y,
    }
    onSave(data, deps)
  }

  function handleDelete() {
    if (!task || !onDelete) return
    if (confirm('Delete this task?')) {
      taskDB.delete(task.id)
      setDeadlineError('')
      onDelete()
    }
  }

  return (
    <Modal title={isEditing ? 'Edit Task' : 'Add Task'} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{isEditing ? 'Edit Task' : 'Add Task'}</h3>
        {isEditing && (
          <button onClick={handleDelete} style={{ background: 'none', border: 'none', color: '#e84040', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>Delete</button>
        )}
      </div>
      <label style={S.label}>Task Title</label>
      <input style={S.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Backend API Setup" autoFocus />
      <label style={S.label}>Description</label>
      <textarea style={{ ...S.input, height: '70px', resize: 'none' }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="What needs to be done?" />
      <label style={S.label}>Assign To</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {members.map(m => (
          <button key={m.userId} onClick={() => setAssigneeIds(d => d.includes(m.userId) ? d.filter(x => x !== m.userId) : [...d, m.userId])}
            style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #333', fontSize: '12px', cursor: 'pointer', background: assigneeIds.includes(m.userId) ? '#e84040' : '#1a1a1a', color: assigneeIds.includes(m.userId) ? '#fff' : '#888' }}>
            {m.user.name} ({m.role})
          </button>
        ))}
      </div>
      <label style={S.label}>Deadline</label>
      <input type="date" style={{ ...S.input, borderColor: deadlineError ? '#e84040' : undefined }} value={deadline} onChange={e => handleDeadlineChange(e.target.value)} min={new Date().toISOString().split('T')[0]} />
      {deadlineError && <div style={{ color: '#e84040', fontSize: '12px', marginTop: '6px' }}>{deadlineError}</div>}
      {existingTasks.length > 0 && (
        <>
          <label style={S.label}>Dependencies (optional)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
            {existingTasks.map(t => (
              <button key={t.id} onClick={() => setDeps(d => d.includes(t.id) ? d.filter(x => x !== t.id) : [...d, t.id])}
                style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #333', fontSize: '12px', cursor: 'pointer', background: deps.includes(t.id) ? '#e84040' : '#1a1a1a', color: deps.includes(t.id) ? '#fff' : '#888' }}>
                {t.title}
              </button>
            ))}
          </div>
        </>
      )}
      <button style={{ ...S.red, width: '100%' }} onClick={save}>{isEditing ? 'Save Changes' : 'Create Task'}</button>
    </Modal>
  )
}

function SubmitTaskModal({ task, onClose, onSubmit }: { task: Task; onClose: () => void; onSubmit: (link: string) => void }) {
  const [link, setLink] = useState('')
  const [comment, setComment] = useState('')
  return (
    <Modal title="Submit Task" onClose={onClose}>
      <div style={{ background: '#0e0e0e', borderRadius: '6px', padding: '12px 14px', marginBottom: '18px' }}>
        <div style={{ fontWeight: 600, marginBottom: '3px' }}>{task.title}</div>
        <div style={{ fontSize: '12px', color: '#666' }}>Due: {task.deadline}</div>
      </div>
      <label style={S.label}>Link to your work</label>
      <input style={S.input} value={link} onChange={e => setLink(e.target.value)} placeholder="https://docs.google.com/…" autoFocus />
      <label style={S.label}>Comment (optional)</label>
      <textarea style={{ ...S.input, height: '80px', resize: 'none' }} value={comment} onChange={e => setComment(e.target.value)} placeholder="Anything to note for the leader…" />
      <div style={{ display: 'flex', gap: '10px' }}>
        <button style={{ ...S.red, flex: 1 }} onClick={() => onSubmit(link)}>Submit</button>
        <button style={{ ...S.ghost, flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ─── Small components ──────────────────────────────────────────────────────────

function RoomCard({ room, onClick }: { room: Room; onClick: () => void }) {
  const allTasks = taskDB.forRoom(room.id)
  const done = allTasks.filter(t => t.status === 'done').length
  const pct = allTasks.length > 0 ? Math.round(done / allTasks.length * 100) : 0
  return (
    <div onClick={onClick} style={{ background: room.color, borderRadius: '8px', padding: '22px 26px', cursor: 'pointer', transition: 'opacity 0.15s, transform 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff', marginBottom: '5px' }}>{room.title}</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.65)', marginBottom: '14px' }}>{room.description}</div>
        </div>
        {allTasks.length > 0 && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginLeft: '12px', flexShrink: 0 }}>{pct}%</span>}
      </div>
      {allTasks.length > 0 && (
        <div style={{ height: '3px', background: 'rgba(255,255,255,0.15)', borderRadius: '2px', marginBottom: '12px' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'rgba(255,255,255,0.65)', borderRadius: '2px', transition: 'width 0.4s' }} />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>{userDB.find(room.leaderId)?.name ?? 'Unknown'}</span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: "'DM Mono', monospace" }}>{allTasks.length} task{allTasks.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const c = STATUS[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: c.pillBg, color: c.pillText, border: `1px solid ${c.nodeBorder}40`, whiteSpace: 'nowrap' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {c.label}
    </span>
  )
}

function FilterPill({ active, label, onClick, statusKey }: { active: boolean; label: string; onClick: () => void; statusKey?: string }) {
  const cfg = statusKey && statusKey !== 'all' ? STATUS[statusKey as TaskStatus] : null
  return (
    <button onClick={onClick} style={{
      padding: '5px 14px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
      border: active && cfg ? `1.5px solid ${cfg.nodeBorder}` : active ? '1.5px solid #e84040' : '1px solid #2a2a2a',
      background: active && cfg ? cfg.pillBg : active ? '#e84040' : '#151515',
      color: active && cfg ? cfg.pillText : active ? '#fff' : '#555',
      fontWeight: active ? 600 : 400, transition: 'all 0.15s',
      display: 'flex', alignItems: 'center', gap: '6px',
    }}>
      {cfg && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: active ? cfg.dot : '#444', flexShrink: 0 }} />}
      {label}
    </button>
  )
}

function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, color: '#fff', flexShrink: 0, userSelect: 'none' }}>
      {name[0]?.toUpperCase()}
    </div>
  )
}

function SidebarBtn({ label, active, onClick, dim }: { label: string; active: boolean; onClick: () => void; dim?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: active ? '#e0e0e0' : 'transparent', border: 'none', borderRadius: '5px', fontSize: '13px', color: dim ? '#888' : '#333', cursor: 'pointer', marginBottom: '2px', fontFamily: 'Inter, sans-serif', fontWeight: active ? 600 : 400 }}>
      {label}
    </button>
  )
}

function DropItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', fontSize: '13px', color: danger ? '#e84040' : '#bbb', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#222')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
      {label}
    </button>
  )
}

function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: '#0e0e0e', borderRadius: '6px', padding: '12px', marginBottom: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '14px', color: '#e0e0e0', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function Divider() {
  return <div style={{ height: '1px', background: '#e0e0e0', margin: '10px 8px' }} />
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '40px 0', textAlign: 'center', color: '#555', fontSize: '14px' }}>{text}</div>
}
