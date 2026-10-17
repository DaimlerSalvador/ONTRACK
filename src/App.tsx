import { useState, useEffect, useRef, useCallback } from 'react'
import {
  initDB, migrateDB, userDB, roomDB, memberDB, taskDB, messageDB, notifDB,
  relativeTime, fmtTime, now,
  type User, type Room, type RoomMember, type Task, type Message,
  type Notification, type TaskStatus, type Role,
} from './database'
import { waitForFirebase } from './firebase'
import { initFirebaseSync, writeRow, deleteRow, syncTable } from './firebase-db'
import { applyTheme, stopThemeObserver, type Theme } from './theme'
import registerBackground from './assets/registerbackground.jpg'
import logoImg from './assets/logo.jpg'

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'landing' | 'login' | 'register' | 'home' | 'room' | 'profile' | 'archived'
type RoomTab = 'flowchart' | 'alltasks' | 'mytasks' | 'members' | 'settings'

const ROOM_COLORS = ['#7a1c1c', '#1a5230', '#152850', '#7a6200', '#4a1080', '#1a4a5c']

const STATUS: Record<TaskStatus, { label: string; nodeColor: string; nodeBorder: string; nodeText: string; dot: string; pillBg: string; pillText: string }> = {
  'not-started': { label: 'Not Started', nodeColor: '#ffffff', nodeBorder: '#cccccc', nodeText: '#1a1a1a', dot: '#aaaaaa', pillBg: '#2a2a2a', pillText: '#888888' },
  'in-progress': { label: 'In Progress', nodeColor: '#7a7e1e', nodeBorder: '#9a9e2e', nodeText: '#ffffff', dot: '#c8cc3a', pillBg: '#2a2a10', pillText: '#c8cc3a' },
  'submitted':   { label: 'Submitted',   nodeColor: '#2e4dbb', nodeBorder: '#4a6ad4', nodeText: '#ffffff', dot: '#6a8af4', pillBg: '#131a3a', pillText: '#6a8af4' },
  'done':        { label: 'Done',        nodeColor: '#1e5c2e', nodeBorder: '#2e8c44', nodeText: '#ffffff', dot: 'var(--ontrack-success)', pillBg: '#0e2218', pillText: 'var(--ontrack-success)' },
  'revision':    { label: 'Need Revision', nodeColor: '#b84a00', nodeBorder: '#e06000', nodeText: '#ffffff', dot: '#f97316', pillBg: '#2a1500', pillText: '#f97316' },
  'late':        { label: 'Late',        nodeColor: '#b02020', nodeBorder: '#d43030', nodeText: '#ffffff', dot: '#f87171', pillBg: '#2a0e0e', pillText: '#f87171' },
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  red: { background: 'var(--ontrack-primary)', border: 'none', color: '#fff', fontSize: '13px', fontWeight: 600, padding: '9px 18px', borderRadius: '5px', cursor: 'pointer' } as React.CSSProperties,
  ghost: { background: 'transparent', border: '1px solid var(--ontrack-border)', color: 'var(--ontrack-text-secondary)', fontSize: '13px', fontWeight: 500, padding: '9px 18px', borderRadius: '5px', cursor: 'pointer' } as React.CSSProperties,
  danger: { background: 'transparent', border: '1px solid var(--ontrack-primary)', color: 'var(--ontrack-primary)', fontSize: '13px', fontWeight: 500, padding: '9px 18px', borderRadius: '5px', cursor: 'pointer' } as React.CSSProperties,
  label: { display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--ontrack-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } as React.CSSProperties,
  input: { display: 'block', width: '100%', background: 'var(--ontrack-input-bg)', border: '1px solid var(--ontrack-border)', color: 'var(--ontrack-text)', fontSize: '14px', padding: '10px 12px', borderRadius: '5px', marginBottom: '14px', boxSizing: 'border-box' } as React.CSSProperties,
}

// ─── Root app ──────────────────────────────────────────────────────────────────

export default function App() {
  // Initialize currentUser from session on startup
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (typeof localStorage === 'undefined') return null
    try {
      const sessionId = localStorage.getItem('ontrack_session')
      if (sessionId) {
        // We need to access userDB, but it's not available here yet
        // We'll do a lazy init in the effect instead
      }
    } catch {}
    return null
  })
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('landing')

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
  const [showChat, setShowChat] = useState(false)
  const [authError, setAuthError] = useState('')
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof localStorage === 'undefined') return 'light'
    return (localStorage.getItem('ontrack_theme') as Theme) ?? 'light'
  })

  // Modals
  const [mCreateRoom, setMCreateRoom] = useState(false)
  const [mJoinRoom, setMJoinRoom] = useState(false)
  const [mCreateTask, setMCreateTask] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [reopeningTask, setReopeningTask] = useState<Task | null>(null)
  const [mTaskDetail, setMTaskDetail] = useState<Task | null>(null)
  const [mSubmitTask, setMSubmitTask] = useState<Task | null>(null)
  const [mDeleteRoom, setMDeleteRoom] = useState(false)

  const currentRoom = rooms.find(r => r.id === currentRoomId) ?? null
  const myRole: Role = currentRoom ? (memberDB.role(currentRoom.id, currentUser?.id ?? '') ?? 'member') : 'member'

  // ── Init ──

  useEffect(() => {
    migrateDB()
    initDB()

    // Restore session
    const sessionId = localStorage.getItem('ontrack_session')
    if (sessionId) {
      const user = userDB.find(sessionId)
      if (user) {
        setCurrentUser(user)
        // Restore view and room state
        const savedView = localStorage.getItem('ontrack_view') as View | null
        const savedRoomId = localStorage.getItem('ontrack_roomId')
        const savedTab = localStorage.getItem('ontrack_roomTab') as RoomTab | null
        if (savedView && savedView !== 'landing' && savedView !== 'login' && savedView !== 'register') {
          setView(savedView)
        }
        if (savedRoomId) {
          setCurrentRoomId(savedRoomId)
        }
        if (savedTab) {
          setRoomTab(savedTab)
        }
      }
    }

    // Initialize Firebase sync (degrades gracefully if unavailable)
    waitForFirebase(3000).then((ok) => {
      if (ok) {
        initFirebaseSync()
      }
    })
    setReady(true)
  }, [])

  // Persist view, room, tab to localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('ontrack_view', view)
      localStorage.setItem('ontrack_roomId', currentRoomId ?? '')
      localStorage.setItem('ontrack_roomTab', roomTab)
    } else {
      localStorage.removeItem('ontrack_view')
      localStorage.removeItem('ontrack_roomId')
      localStorage.removeItem('ontrack_roomTab')
    }
  }, [view, currentRoomId, roomTab, currentUser])

  // ── Theme ──

  useEffect(() => {
    stopThemeObserver()
    applyTheme(theme)
  }, [theme])

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
    const lateTasks = taskDB.checkLate(currentRoomId)
    lateTasks.forEach(t => writeRow('tasks', t))
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

  function handleRegister(firstName: string, lastName: string, email: string, password: string) {
    const result = userDB.register(`${firstName} ${lastName}`, email, password)
    if (typeof result === 'string') { setAuthError(result); return }
    writeRow('users', result)
    syncTable('users')
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

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
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
    const safeTab = (tab === 'settings' || tab === 'alltasks') && role !== 'leader' ? 'flowchart' : tab
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
    console.debug('[autoArrange] START')
    if (!currentRoom) {
      console.debug('[autoArrange] No currentRoom, returning')
      return
    }
    const allTasks = taskDB.forRoom(currentRoom.id)
    console.debug('[autoArrange] tasks:', allTasks.map(t => ({ id: t.id, title: t.title, status: t.status })))
    const taskDepsMap = Object.fromEntries(allTasks.map(t => [t.id, taskDB.deps(t.id)]))
    const layout = computeFlowchartLayout(allTasks, taskDepsMap)
    console.debug('[autoArrange] layout:', layout)
    allTasks.forEach(t => {
      const pos = layout[t.id]
      if (pos) {
        const updated = taskDB.update(t.id, { x: pos.x, y: pos.y })
        if (updated) writeRow('tasks', updated)
      }
    })
    console.debug('[autoArrange] calling loadRoomData')
    loadRoomData()
    console.debug('[autoArrange] loadRoomData done')
    // Non-blocking Firestore sync
    syncTable('tasks')
    console.debug('[autoArrange] COMPLETE')
  }

  // ── Task actions ──

  async function createTask(data: Omit<Task, 'id' | 'createdAt'>, deps: string[]) {
    console.debug('[createTask] START data:', data, 'deps:', deps)
    try {
      const task = taskDB.insert(data, deps)
      console.debug('[createTask] inserted:', task)
      writeRow('tasks', task)
      syncTable('task_deps') // fire-and-forget
      console.debug('[createTask] calling autoArrange')
      autoArrange()
      console.debug('[createTask] autoArrange done, setting mCreateTask=false')
      setMCreateTask(false)
      loadNotifs()
      console.debug('[createTask] COMPLETE')
    } catch (e) {
      console.error('[createTask] Error:', e)
    }
  }

  async function updateTask(id: string, data: Omit<Task, 'id' | 'createdAt'>, deps: string[]) {
    console.debug('[updateTask] START id:', id, 'data:', data, 'deps:', deps)
    try {
      taskDB.update(id, data)
      taskDB.setDeps(id, deps)
      const updated = taskDB.forRoom(currentRoomId ?? '').find(t => t.id === id)
      if (updated) writeRow('tasks', updated)
      syncTable('task_deps') // fire-and-forget
      console.debug('[updateTask] calling autoArrange')
      autoArrange()
      console.debug('[updateTask] autoArrange done, setting editingTask=null')
      setEditingTask(null)
      loadNotifs()
      console.debug('[updateTask] COMPLETE')
    } catch (e) {
      console.error('[updateTask] Error:', e)
    }
  }

  async function submitTask(taskId: string, link: string) {
    if (!currentRoom) return
    taskDB.submit(taskId, link, currentRoom.leaderId)
    const updated = taskDB.forRoom(currentRoom.id).find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMSubmitTask(null)
    autoArrange()
    loadNotifs()
  }

  async function startTask(taskId: string) {
    taskDB.update(taskId, { status: 'in-progress' })
    const updated = taskDB.forRoom(currentRoomId ?? '').find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMTaskDetail(null)
    autoArrange()
    loadNotifs()
  }

  async function approveTask(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    taskDB.approve(taskId, task.assigneeIds)
    const updated = taskDB.forRoom(currentRoom?.id ?? '').find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMTaskDetail(null)
    autoArrange()
    loadNotifs()
  }

  async function requestRevision(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    taskDB.requestRevision(taskId, task.assigneeIds)
    const updated = taskDB.forRoom(currentRoom?.id ?? '').find(t => t.id === taskId)
    if (updated) writeRow('tasks', updated)
    setMTaskDetail(null)
    autoArrange()
    loadNotifs()
  }

  async function deleteTask(taskId: string) {
    taskDB.delete(taskId)
    deleteRow('tasks', taskId) // fire-and-forget
    syncTable('task_deps') // fire-and-forget
    setMTaskDetail(null)
    autoArrange()
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

  function changeName(firstName: string, lastName: string): string | null {
    if (!currentUser) return 'Not logged in.'
    if (!firstName.trim()) return 'First name is required.'
    if (!lastName.trim()) return 'Last name is required.'
    const updated = userDB.update(currentUser.id, { name: `${firstName.trim()} ${lastName.trim()}` })
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
  const doneCountAll  = tasks.filter(t => t.status === 'done').length
  const donePctAll    = tasks.length ? Math.round((doneCountAll / tasks.length) * 100) : 0

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
        <ProfileView user={currentUser} onLogout={handleLogout} onSwitchAccount={handleSwitchAccount} onChangePassword={changePassword} onChangeName={changeName} theme={theme} onToggleTheme={toggleTheme} />
      )}

      {/* ━━━ ARCHIVED ━━━ */}
{view === 'archived' && (
        <div style={{ padding: '32px 40px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '24px' }}>Archived Rooms</h2>
          {archivedRooms.length === 0
            ? <Empty text="No archived rooms." />
            : archivedRooms.map(r => (
                <div key={r.id} style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderLeft: `4px solid ${r.color}`, borderRadius: '7px', padding: '18px 22px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '3px' }}>{r.title}</div>
                    <div style={{ fontSize: '13px', color: 'var(--ontrack-text-muted)', marginBottom: '3px' }}>{r.description}</div>
                    <div style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)' }}>Leader: {userDB.find(r.leaderId)?.name}</div>
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
        const allFilteredTasks = tasks.filter(t => statusFilter === 'all' || t.status === statusFilter).sort((a, b) => {
          if (a.status === 'submitted' && b.status !== 'submitted') return -1
          if (a.status !== 'submitted' && b.status === 'submitted') return 1
          return 0
        })
        const taskDeps = Object.fromEntries(tasks.map(t => [t.id, taskDB.deps(t.id)]))
        const getUserName = (id: string) => userDB.find(id)?.name ?? id
        const dueLabel = (deadline: string): string => {
          const now = new Date()
          now.setHours(0, 0, 0, 0)
          const d = new Date(deadline)
          d.setHours(0, 0, 0, 0)
          const diffDays = Math.round((d.getTime() - now.getTime()) / 86400000)
          if (diffDays > 0) return `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`
          if (diffDays === 0) return 'Due today'
          return `${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''} overdue`
        }

        return (
          <>
            {/* Room header + tab bar */}
            <div style={{ borderBottom: '1px solid var(--ontrack-border)', padding: '0 32px', background: 'var(--ontrack-bg)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: '20px', paddingBottom: '4px' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 800 }}>{currentRoom.title}</div>
                  <div style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)', marginTop: '2px' }}>{currentRoom.description}</div>
                </div>
                {myRole === 'leader' && (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <button style={{ ...S.ghost, fontSize: '12px', padding: '6px 14px' }} onClick={() => setShowRoomMenu(v => !v)}>⋯</button>
                    {showRoomMenu && (
                      <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '7px', minWidth: '170px', zIndex: 60, overflow: 'hidden' }}>
                        <DropItem label="Archive Room" onClick={() => { archiveRoom(currentRoom.id); setShowRoomMenu(false) }} />
                        <DropItem label="Delete Room" danger onClick={() => { setMDeleteRoom(true); setShowRoomMenu(false) }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--ontrack-border)' }}>
                {(['flowchart', ...(myRole === 'leader' ? ['alltasks'] : []), 'mytasks', 'members', ...(myRole === 'leader' ? ['settings'] : [])] as RoomTab[]).map(t => (
                  <button key={t} onClick={() => setRoomTab(t)} style={{
                    background: 'none', border: 'none', padding: '10px 20px', fontSize: '13px',
                    cursor: 'pointer', fontWeight: roomTab === t ? 600 : 400,
                    color: roomTab === t ? 'var(--ontrack-text)' : 'var(--ontrack-text-muted)',
                    borderBottom: `2px solid ${roomTab === t ? 'var(--ontrack-primary)' : 'transparent'}`,
                    transition: 'color 0.15s',
                  }}>
                    {t === 'mytasks' ? 'My Tasks' : t === 'alltasks' ? 'All Tasks' : t.charAt(0).toUpperCase() + t.slice(1)}
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

              {/* ── All Tasks (leader monitor) ── */}
              {roomTab === 'alltasks' && myRole === 'leader' && (
                <div style={{ padding: '24px 32px' }}>
                  {/* Summary strip */}
                  <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '10px', padding: '18px 22px', marginBottom: '22px', display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '210px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--ontrack-text-muted)' }}>
                        <span>Progress</span>
                        <span>{doneCountAll} of {tasks.length} done ({donePctAll}%)</span>
                      </div>
                      <div style={{ height: '8px', background: 'var(--ontrack-border)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: donePctAll + '%', background: 'var(--ontrack-success)' }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', minWidth: '240px' }}>
                      {(['not-started','in-progress','submitted','done','revision','late'] as const).map(s => {
                        const c = STATUS[s]
                        const count = tasks.filter(t => t.status === s).length
                        return (
                          <button key={s} onClick={() => setStatusFilter(s)} style={{
                            padding: '6px 12px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600,
                            border: '1px solid ' + c.nodeBorder + '40',
                            background: statusFilter === s ? c.pillBg : 'var(--ontrack-surface-alt)',
                            color: statusFilter === s ? c.pillText : 'var(--ontrack-text-secondary)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '6px',
                          }}>
                            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
                            {c.label} <span style={{ fontWeight: 500, opacity: 0.85 }}>({count})</span>
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ width: '72px', height: '72px', borderRadius: '50%',
                      background: 'conic-gradient(var(--ontrack-success) 0deg ' + (donePctAll * 3.6) + 'deg, var(--ontrack-border) ' + (donePctAll * 3.6) + 'deg 360deg)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--ontrack-text)' }}>
                      {donePctAll}%
                    </div>
                  </div>

                  {allFilteredTasks.length === 0
                    ? <Empty text={tasks.length === 0 ? 'No tasks yet. Add the first task to get started.' : 'No tasks match this filter.'} />
                    : allFilteredTasks.map(task => (
                      <div key={task.id} onClick={() => setMTaskDetail(task)} style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '7px', padding: '16px 20px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--ontrack-primary)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--ontrack-border)')}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{task.title}</div>
                          <div style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)' }}>
                            {dueLabel(task.deadline)}
                            {task.assigneeIds.length > 0 && (
                              <span style={{ marginLeft: '10px' }}>· {task.assigneeIds.map(id => getUserName(id)).join(', ')}</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                          <StatusBadge status={task.status} />
                        </div>
                      </div>
                    ))}
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
                      <div key={task.id} onClick={() => setMTaskDetail(task)} style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '7px', padding: '16px 20px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--ontrack-border)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--ontrack-border)')}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{task.title}</div>
                          <div style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)' }}>{dueLabel(task.deadline)}</div>
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

              {/* ── Members ── */}
              {roomTab === 'members' && (
                <div style={{ padding: '24px 32px' }}>
                  {myRole === 'leader' && (
                    <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '7px', padding: '14px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ontrack-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Join Code</span>
                      <code style={{ fontFamily: "'DM Mono', monospace", fontSize: '17px', fontWeight: 700, letterSpacing: '0.15em', color: 'var(--ontrack-text)' }}>{currentRoom.code}</code>
                      <button style={{ ...S.ghost, fontSize: '11px', padding: '4px 10px', marginLeft: 'auto' }}
                        onClick={() => navigator.clipboard?.writeText(currentRoom.code)}>Copy</button>
                    </div>
                  )}
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                     {members.map(m => (
                       <div key={m.userId} style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '7px', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                           <Avatar name={m.user.name} color={m.role === 'leader' ? 'var(--ontrack-primary)' : 'var(--ontrack-border)'} />
                           <div>
                             <div style={{ fontWeight: 500 }}>{m.user.name}</div>
                             <div style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)' }}>{m.user.email}</div>
                           </div>
                         </div>
                         <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                           <span style={{ fontSize: '11px', fontWeight: 700, color: m.role === 'leader' ? 'var(--ontrack-primary)' : 'var(--ontrack-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.role}</span>
                           {myRole === 'leader' && m.role !== 'leader' && (
                             <button style={{ ...S.danger, fontSize: '11px', padding: '4px 10px' }} onClick={() => { if (confirm(`Remove ${m.user.name}?`)) removeMember(currentRoom.id, m.userId) }}>Remove</button>
                           )}
                         </div>
                       </div>
                     ))}
                   </div>
                   {myRole === 'member' && (
                     <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--ontrack-border)' }}>
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
                <p style={{ color: 'var(--ontrack-text-secondary)', fontSize: '14px', lineHeight: 1.6, marginBottom: '18px' }}>{mTaskDetail.description}</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                  <InfoBox label="Assignees" value={mTaskDetail.assigneeIds.length ? mTaskDetail.assigneeIds.map(id => getUserName(id)).join(', ') : 'Unassigned'} />
                  <InfoBox label="Deadline" value={mTaskDetail.deadline} />
                </div>
                {mTaskDetail.submissionLink && (
                  <div style={{ marginBottom: '14px' }}>
                    <InfoBox label="Submission Link" value={<a href={mTaskDetail.submissionLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ontrack-info)', fontSize: '13px', wordBreak: 'break-all' }}>{mTaskDetail.submissionLink}</a>} />
                  </div>
                )}
                {((myRole === 'leader' && mTaskDetail.status === 'submitted') || (mTaskDetail.assigneeIds.includes(currentUser.id) && mTaskDetail.status === 'not-started') || (mTaskDetail.assigneeIds.includes(currentUser.id) && (mTaskDetail.status === 'in-progress' || mTaskDetail.status === 'revision' || mTaskDetail.status === 'late')) || (myRole === 'leader' && mTaskDetail.status !== 'submitted')) ? (
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
                    {myRole === 'leader' && mTaskDetail.status !== 'submitted' && (
                      <button style={{ ...S.ghost, fontSize: '12px', padding: '7px 12px' }} onClick={() => { setEditingTask(mTaskDetail); setMTaskDetail(null) }}>Edit Task</button>
                    )}
                    {myRole === 'leader' && mTaskDetail.status === 'done' && (
                      <button style={{ ...S.red, fontSize: '12px', padding: '7px 12px' }} onClick={() => { setReopeningTask(mTaskDetail); setEditingTask(mTaskDetail); setMTaskDetail(null) }}>Reopen Task</button>
                    )}
                  </div>
                ) : null}
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
                onClose={() => { setMCreateTask(false); setEditingTask(null); setReopeningTask(null) }}
                onSave={(data, deps) => {
                  if (editingTask) {
                    const finalData = reopeningTask ? { ...data, status: 'not-started' as TaskStatus } : data
                    updateTask(editingTask.id, finalData, deps)
                    setReopeningTask(null)
                  } else {
                    createTask(data, deps)
                  }
                }}
                onDelete={() => { if (editingTask) deleteTask(editingTask.id); setEditingTask(null) }}
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
                <p style={{ color: 'var(--ontrack-text-secondary)', fontSize: '14px', marginBottom: '20px', lineHeight: 1.6 }}>
                  Are you sure you want to permanently delete <strong style={{ color: 'var(--ontrack-text)' }}>{currentRoom.title}</strong>? This will remove all tasks, members, and messages. This action cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button style={{ ...S.danger, flex: 1 }} onClick={() => deleteRoom(currentRoom.id)}>Delete Room</button>
                  <button style={{ ...S.ghost, flex: 1 }} onClick={() => setMDeleteRoom(false)}>Cancel</button>
                </div>
</Modal>
            )}

            {/* Floating Chat Panel */}
            {showChat && (
              <div style={{ position: 'fixed', bottom: '90px', right: '24px', zIndex: 200, width: '380px', maxHeight: '500px', background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '12px', boxShadow: '0 16px 48px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideIn 0.2s ease-out' }}>
                <div style={{ background: 'var(--ontrack-primary)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>Messages</span>
                  <button onClick={() => setShowChat(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
                </div>
                <ChatView
                  messages={messages}
                  currentUserId={currentUser.id}
                  getUserName={getUserName}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  onSend={sendMessage}
                  compact={true}
                />
              </div>
            )}

            {/* Floating Chat Button */}
            <button
              onClick={() => setShowChat(v => !v)}
              style={{
                position: 'fixed', bottom: '24px', right: '24px', zIndex: 190,
                width: '56px', height: '56px', borderRadius: '50%',
                background: 'var(--ontrack-primary)', border: 'none',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              aria-label="Open chat"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path>
              </svg>
            </button>

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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--ontrack-bg)', color: 'var(--ontrack-text)', fontFamily: 'Inter, sans-serif' }}>
      {/* Top nav */}
      <header style={{ height: '50px', background: 'var(--ontrack-bg)', borderBottom: '1px solid var(--ontrack-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => setSidebarOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: 'var(--ontrack-text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ width: '18px', height: '2px', background: 'var(--ontrack-text-secondary)', borderRadius: '1px' }}></span>
            <span style={{ width: '18px', height: '2px', background: 'var(--ontrack-text-secondary)', borderRadius: '1px' }}></span>
            <span style={{ width: '18px', height: '2px', background: 'var(--ontrack-text-secondary)', borderRadius: '1px' }}></span>
          </button>
          <img src={logoImg} alt="ONTRACK" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />
          <button onClick={() => setView('home')} style={{ fontFamily: "'DM Mono', monospace", fontSize: '14px', fontWeight: 700, letterSpacing: '0.18em', color: 'var(--ontrack-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>ONTRACK</button>
          {view === 'room' && currentRoom && <span style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)' }}>/ {currentRoom.title}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ position: 'relative' }}>
            <button onClick={onToggleNotifs} className={unread > 0 ? 'notif-bell has-unread' : 'notif-bell'} style={{ background: unread > 0 ? 'var(--ontrack-primary-tint)' : 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', color: unread > 0 ? 'var(--ontrack-primary)' : 'var(--ontrack-text-muted)', fontSize: '15px', position: 'relative', borderRadius: '6px' }}>
              🔔
              {unread > 0 && <span className="notif-badge" style={{ position: 'absolute', top: '0px', right: '0px', minWidth: '18px', height: '18px', background: 'var(--ontrack-primary)', borderRadius: '9px', border: '2px solid var(--ontrack-bg)', fontSize: '11px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread > 9 ? '9+' : unread}</span>}
            </button>
            {showNotifs && (
              <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '9px', width: '320px', zIndex: 200, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ontrack-border)', fontSize: '11px', fontWeight: 700, color: 'var(--ontrack-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Notifications</div>
                {notifications.length === 0
                  ? <div style={{ padding: '20px 16px', color: 'var(--ontrack-text-muted)', fontSize: '13px', textAlign: 'center' }}>All caught up!</div>
                  : notifications.slice(0, 8).map(n => {
                    const room = roomDB.find(n.roomId)
                    return (
                      <div key={n.id} style={{ padding: '12px 16px', fontSize: '13px', fontWeight: n.read ? 400 : 600, color: n.read ? 'var(--ontrack-text-secondary)' : 'var(--ontrack-text)', background: n.read ? 'transparent' : 'var(--ontrack-primary-tint)', borderBottom: '1px solid var(--ontrack-border)', display: 'flex', gap: '10px' }}>
                        <span style={{ color: n.read ? 'var(--ontrack-text-secondary)' : 'var(--ontrack-primary)', flexShrink: 0, marginTop: '1px', fontSize: '14px' }}>●</span>
                        <div style={{ flex: 1 }}>
                          <div>{n.text}</div>
                          <div style={{ fontSize: '11px', color: 'var(--ontrack-text-secondary)', marginTop: '3px' }}>
                            {room ? `In ${room.title}` : ''}{room ? ' · ' : ''}{relativeTime(n.createdAt)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            )}
          </div>
          {currentUser && (
             <button onClick={() => setView('profile')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', color: 'var(--ontrack-text-secondary)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser.name}</span>
             </button>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sidebarOpen && (
        <aside style={{ width: '210px', background: 'var(--ontrack-surface-elevated)', borderRight: '1px solid var(--ontrack-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ padding: '14px 10px' }}>
            {view === 'room' && currentRoom && (() => {
              const role = memberDB.role(currentRoom.id, currentUser?.id ?? '')
              const tabs = (['flowchart', ...(role === 'leader' ? ['alltasks'] : []), 'mytasks','chat','members',...(role === 'leader' ? ['settings'] : [])] as RoomTab[])
              return (
              <>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--ontrack-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 8px', marginBottom: '6px' }}>Navigation</div>
                {tabs.map(t => (
                  <SidebarBtn key={t} label={t === 'mytasks' ? 'My Tasks' : t === 'alltasks' ? 'All Tasks' : t.charAt(0).toUpperCase() + t.slice(1)} active={roomTab === t} onClick={() => setRoomTab(t)} />
                ))}
                <Divider />
              </>
              )
            })()}
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--ontrack-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 8px', marginBottom: '6px' }}>Rooms</div>
            {activeRooms.length === 0
              ? <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--ontrack-text-secondary)' }}>No rooms yet.</div>
              : activeRooms.map(r => (
                <button key={r.id} onClick={() => onRoomClick(r.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px 8px 11px',
                   background: currentRoom?.id === r.id ? 'var(--ontrack-primary-tint)' : 'transparent',
                   border: 'none', borderRadius: '5px', fontSize: '13px', color: currentRoom?.id === r.id ? 'var(--ontrack-primary)' : 'var(--ontrack-text-secondary)',
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
        )}

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
  const [showInfo, setShowInfo] = useState(false)
  return (
    <div style={{ minHeight: '100vh', background: 'var(--ontrack-bg)', position: 'relative', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="none">
        <ellipse cx="25%" cy="55%" rx="48%" ry="38%" fill="none" stroke="var(--ontrack-border)" strokeWidth="1.5" transform="rotate(-12,400,400)" />
        <ellipse cx="72%" cy="35%" rx="38%" ry="30%" fill="none" stroke="var(--ontrack-surface)" strokeWidth="1" transform="rotate(8,700,300)" />
        <ellipse cx="55%" cy="75%" rx="55%" ry="22%" fill="none" stroke="var(--ontrack-surface)" strokeWidth="1" transform="rotate(-3,600,500)" />
        <ellipse cx="80%" cy="62%" rx="28%" ry="42%" fill="none" stroke="var(--ontrack-border)" strokeWidth="1.5" transform="rotate(18,800,500)" />
        <ellipse cx="15%" cy="25%" rx="22%" ry="35%" fill="none" stroke="var(--ontrack-surface)" strokeWidth="1" transform="rotate(-25,200,200)" />
      </svg>
      <nav style={{ position: 'relative', zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 48px', borderBottom: '1px solid var(--ontrack-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src={logoImg} alt="ONTRACK" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '15px', fontWeight: 700, letterSpacing: '0.18em', color: 'var(--ontrack-text)' }}>ONTRACK</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={onLogin} style={{ background: 'none', border: 'none', color: 'var(--ontrack-text-muted)', fontSize: '13px', cursor: 'pointer', padding: '8px 14px' }}>Log in</button>
          <button onClick={onRegister} style={{ ...S.red, fontSize: '13px' }}>Register Now</button>
        </div>
      </nav>
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 58px)', textAlign: 'center', padding: '0 24px' }}>
        <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.2em', color: 'var(--ontrack-text-muted)', marginBottom: '24px' }}>STUDENT PROJECT MANAGEMENT</div>
        <h1 style={{ fontSize: 'clamp(36px, 7vw, 72px)', fontWeight: 800, color: 'var(--ontrack-text)', letterSpacing: '-0.03em', lineHeight: 1.05, marginBottom: '22px' }}>
          WELCOME TO <span style={{ color: 'var(--ontrack-primary)' }}>ONTRACK</span>
        </h1>
        <p style={{ fontSize: '16px', color: 'var(--ontrack-text-secondary)', maxWidth: '380px', lineHeight: 1.7, marginBottom: '40px' }}>Track tasks. Visualize progress. Hit every deadline.</p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onRegister} style={{ ...S.red, fontSize: '15px', padding: '13px 36px' }}>Get Started</button>
          <button onClick={onLogin} style={{ ...S.ghost, fontSize: '15px', padding: '13px 36px' }}>Log in</button>
        </div>
        <div style={{ marginTop: '70px', display: 'flex', gap: '40px', color: 'var(--ontrack-text-muted)', fontSize: '13px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {['Flowchart Visualization','Role-Based Access','Real-Time Tracking','Group Chat'].map(f => (
            <span key={f} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ color: 'var(--ontrack-primary)' }}>✓</span>{f}</span>
          ))}
        </div>
        <button onClick={() => setShowInfo(v => !v)} style={{ ...S.ghost, fontSize: '15px', padding: '13px 36px', marginTop: '30px' }}>{showInfo ? 'Hide Info' : 'Learn about OnTrack'}</button>
        {showInfo && (
          <div style={{ marginTop: '40px', maxWidth: '760px', background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '12px', padding: '32px', textAlign: 'left', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>Plan it. Track it. Finish it.</h2>
            <p style={{ color: 'var(--ontrack-text-secondary)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>OnTrack is a web-based task and deadline monitoring system for student groups. Turn your capstone, thesis, or group project into a visual flowchart so everyone can see what needs to be done first, who is responsible, and what is already finished.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '28px' }}>
              <div style={{ padding: '14px', background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '8px' }}><div style={{ fontWeight: 700, color: 'var(--ontrack-primary)', marginBottom: '4px' }}>1</div><div style={{ fontWeight: 600, marginBottom: '2px' }}>Create or join a room</div><div style={{ fontSize: '12px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.5 }}>A leader creates a room and shares the join code.</div></div>
              <div style={{ padding: '14px', background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '8px' }}><div style={{ fontWeight: 700, color: 'var(--ontrack-primary)', marginBottom: '4px' }}>2</div><div style={{ fontWeight: 600, marginBottom: '2px' }}>Build the flowchart</div><div style={{ fontSize: '12px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.5 }}>Leader adds tasks, deadlines, assignees, and dependencies.</div></div>
              <div style={{ padding: '14px', background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '8px' }}><div style={{ fontWeight: 700, color: 'var(--ontrack-primary)', marginBottom: '4px' }}>3</div><div style={{ fontWeight: 600, marginBottom: '2px' }}>Start &amp; submit</div><div style={{ fontSize: '12px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.5 }}>Members click Start, then submit a link to finished work.</div></div>
              <div style={{ padding: '14px', background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '8px' }}><div style={{ fontWeight: 700, color: 'var(--ontrack-primary)', marginBottom: '4px' }}>4</div><div style={{ fontWeight: 600, marginBottom: '2px' }}>Review &amp; approve</div><div style={{ fontSize: '12px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.5 }}>Leader approves or requests a revision.</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <div style={{ padding: '16px', background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '8px', borderLeft: '3px solid var(--ontrack-primary)' }}><div style={{ fontWeight: 700, marginBottom: '8px' }}>Leader</div><ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.7 }}><li>Create and manage project rooms</li><li>Build the flowchart and assign tasks</li><li>Review submissions: approve or request revision</li><li>Remove members, archive, or delete the room</li></ul></div>
              <div style={{ padding: '16px', background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '8px', borderLeft: '3px solid var(--ontrack-border)' }}><div style={{ fontWeight: 700, marginBottom: '8px' }}>Member</div><ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.7 }}><li>Join rooms using a code</li><li>View the full flowchart and everyone's tasks</li><li>Start and submit your assigned tasks</li><li>Chat with your team and receive notifications</li></ul></div>
            </div>
            <div style={{ marginBottom: '20px' }}><div style={{ fontWeight: 700, marginBottom: '12px' }}>Understanding Task Status</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>{(['not-started','in-progress','submitted','revision','done'] as TaskStatus[]).map(s => <div key={s} style={{ padding: '8px', background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '6px', textAlign: 'center' }}><div style={{ width: '10px', height: '10px', borderRadius: '50%', background: STATUS[s].nodeColor, border: `1px solid ${STATUS[s].nodeBorder}`, margin: '0 auto 4px' }}></div><div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--ontrack-text)' }}>{STATUS[s].label}</div></div>)}</div></div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}></div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Auth page ─────────────────────────────────────────────────────────────────

type AuthSubmit = ((email: string, password: string) => void) | ((firstName: string, lastName: string, email: string, password: string) => void)

function AuthPage({ mode, error, onSubmit, onSwitch, onBack }: { mode: 'login' | 'register'; error: string; onSubmit: AuthSubmit; onSwitch: () => void; onBack: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)
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
      (onSubmit as (f: string, l: string, e: string, p: string) => void)(firstName, lastName, email, password)
    }
  }

  return (
    <div data-auth="true" style={{ minHeight: '100vh', background: 'var(--ontrack-bg)', position: 'relative', overflow: 'hidden', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }} preserveAspectRatio="none">
        <ellipse cx="30%" cy="65%" rx="50%" ry="35%" fill="none" stroke="var(--ontrack-border)" strokeWidth="1.5" transform="rotate(-10,400,450)" />
        <ellipse cx="75%" cy="30%" rx="35%" ry="28%" fill="none" stroke="var(--ontrack-surface)" strokeWidth="1" transform="rotate(12,700,250)" />
      </svg>
      <nav style={{ position: 'relative', zIndex: 10, padding: '18px 48px', borderBottom: '1px solid var(--ontrack-border)', background: 'var(--ontrack-bg)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <img src={logoImg} alt="ONTRACK" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />
        <button onClick={onBack} style={{ fontFamily: "'DM Mono', monospace", fontSize: '15px', fontWeight: 700, letterSpacing: '0.18em', color: 'var(--ontrack-text)', background: 'none', border: 'none', cursor: 'pointer' }}>ONTRACK</button>
      </nav>
      <div style={{ flex: 1, display: 'flex', position: 'relative', zIndex: 10, paddingLeft: 0, marginTop: 0 }}>
        {/* Left — value panel */}
        <div style={{ width: '480px', flexShrink: 0, background: 'var(--ontrack-surface)', borderRight: '1px solid var(--ontrack-border)', padding: '56px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '13px', fontWeight: 700, letterSpacing: '0.2em', color: 'var(--ontrack-primary)', marginBottom: '14px' }}>ONTRACK</div>
          <h2 style={{ fontSize: '30px', fontWeight: 800, color: 'var(--ontrack-text)', letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: '12px' }}>Plan it.<br />Track it.<br />Finish it.</h2>
          <p style={{ fontSize: '14px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.6, marginBottom: '28px' }}>Organize your group project as a visual flowchart, assign tasks, and stay on top of every deadline.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '32px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--ontrack-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '12px', color: '#fff', fontWeight: 700 }}>1</span>
              <div><div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--ontrack-text)', marginBottom: '2px' }}>See who's doing what</div><div style={{ fontSize: '13px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.5 }}>Every task has an owner and a deadline, visible to the whole team.</div></div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--ontrack-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '12px', color: '#fff', fontWeight: 700 }}>2</span>
              <div><div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--ontrack-text)', marginBottom: '2px' }}>Know what to do first</div><div style={{ fontSize: '13px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.5 }}>The flowchart shows task order, so nobody is guessing what comes next.</div></div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--ontrack-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '12px', color: '#fff', fontWeight: 700 }}>3</span>
              <div><div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--ontrack-text)', marginBottom: '2px' }}>Get deadline reminders</div><div style={{ fontSize: '13px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.5 }}>In-app alerts for due dates, new tasks, and review updates.</div></div>
            </div>
          </div>
          <div style={{ background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '11px', color: 'var(--ontrack-text-muted)', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mini Flowchart</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
              <div style={{ background: 'var(--ontrack-success)', color: '#fff', padding: '8px 14px', borderRadius: '6px 0 0 6px', fontSize: '13px', fontWeight: 600 }}>Setup</div>
              <div style={{ width: '18px', height: '0', borderLeft: '2px dashed var(--ontrack-border)' }}></div>
              <div style={{ background: 'var(--ontrack-yellow)', color: '#1a1a1a', padding: '8px 14px', fontSize: '13px', fontWeight: 600 }}>Build</div>
              <div style={{ width: '18px', height: '0', borderLeft: '2px dashed var(--ontrack-border)' }}></div>
              <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', color: 'var(--ontrack-text-secondary)', padding: '8px 14px', borderRadius: '0 6px 6px 0', fontSize: '13px', fontWeight: 600 }}>Test</div>
            </div>
            <div style={{ display: 'flex', gap: '14px', marginTop: '12px', fontSize: '11px', color: 'var(--ontrack-text-secondary)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ontrack-success)' }}></span>Done</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ontrack-yellow)' }}></span>In Progress</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)' }}></span>Not Started</span>
            </div>
          </div>
        </div>
        {/* Right — form */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflowY: 'auto', position: 'relative', minHeight: '100vh', width: '100%' }}>
          <div style={{ position: 'absolute', inset: 0, background: `url(${registerBackground}) center/cover no-repeat`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', zIndex: 0 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(2px)', zIndex: 1 }} />
          <div style={{ position: 'relative', zIndex: 2, background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '10px', padding: '48px', width: '480px', boxSizing: 'border-box', marginLeft: '-40px' }}>
          <h2 style={{ fontSize: '26px', fontWeight: 700, marginBottom: '8px', textAlign: 'center', color: 'var(--ontrack-text)' }}>{isLogin ? 'Log in' : 'Create account'}</h2>
          <p style={{ fontSize: '13px', color: 'var(--ontrack-text-secondary)', textAlign: 'center', marginBottom: '28px' }}>{isLogin ? 'Welcome back to ONTRACK' : 'Join your team on ONTRACK'}</p>
          {error && <div style={{ background: 'var(--ontrack-primary-tint)', border: '1px solid var(--ontrack-primary)', borderRadius: '5px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: 'var(--ontrack-primary)' }}>{error}</div>}
          {!isLogin && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={S.label}>First Name</label>
                <input style={S.input} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" autoFocus />
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Last Name</label>
                <input style={S.input} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" />
              </div>
            </div>
          )}
          <label style={S.label}>Email</label>
          <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@university.edu" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          <label style={S.label}>Password</label>
          <div style={{ position: 'relative', marginBottom: '4px' }}>
            <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ontrack-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
              )}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--ontrack-text-muted)', marginTop: '4px', marginBottom: '14px' }}>At least 6 characters</p>
          {!isLogin && (
            <div>
              <label style={S.label}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showConfirm ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ontrack-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {showConfirm ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
                  )}
                </button>
              </div>
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
          {showTermsModal && (
            <Modal title="Terms and Agreement" onClose={() => setShowTermsModal(false)}>
              <div style={{ fontSize: '13px', color: 'var(--ontrack-text-secondary)', lineHeight: 1.7, maxHeight: '60vh', overflowY: 'auto' }}>
                <p style={{ marginBottom: '12px' }}><strong>1. Purpose of the System</strong><br />OnTrack is a task and deadline monitoring system developed as a capstone project for academic use by student groups at Bataan Peninsula State University. It is intended to help manage capstone, thesis, and other collaborative group projects.</p>
                <p style={{ marginBottom: '12px' }}><strong>2. Account Responsibility</strong><br />You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You agree to provide accurate and truthful information during registration.</p>
                <p style={{ marginBottom: '12px' }}><strong>3. Acceptable Use</strong><br />You agree to use OnTrack only for legitimate academic project management purposes. You will not use the system to post harmful, offensive, or misleading content in project rooms, task descriptions, or group chat.</p>
                <p style={{ marginBottom: '12px' }}><strong>4. Content and Submissions</strong><br />Any task submissions made through OnTrack are done via links to externally hosted content (e.g., Google Drive, GitHub, Figma). You are responsible for ensuring that content you link to is accessible to your project room's members and does not violate any third-party rights.</p>
                <p style={{ marginBottom: '12px' }}><strong>5. Data Usage</strong><br />Information you provide (name, email, project data, messages) will be used solely to operate the OnTrack system for its intended academic purpose. As a student capstone project, OnTrack does not sell or share your data with third parties.</p>
                <p style={{ marginBottom: '12px' }}><strong>6. Room Leadership and Access</strong><br />Project leaders have administrative control over their rooms, including the ability to assign tasks, review submissions, remove members, and archive or delete rooms. Members acknowledge that leaders may take these actions as part of normal project management.</p>
                <p style={{ marginBottom: '12px' }}><strong>7. Availability</strong><br />OnTrack is provided as an academic prototype/capstone system. It is provided "as is," and the developers do not guarantee uninterrupted availability or data retention beyond the scope of the course/project period.</p>
                <p style={{ marginBottom: '12px' }}><strong>8. Changes to Terms</strong><br />These terms may be updated as the system evolves during development. Continued use of OnTrack after changes constitutes acceptance of the updated terms.</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button onClick={() => setShowTermsModal(false)} style={{ ...S.red, padding: '8px 20px', fontSize: '13px' }}>Close</button>
              </div>
            </Modal>
          )}
          {!isLogin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', marginBottom: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--ontrack-primary)' }} />
              <span style={{ fontSize: '13px', color: 'var(--ontrack-text-secondary)' }}>I agree to the{' '}
                <span onClick={() => setShowTermsModal(true)} style={{ color: 'var(--ontrack-primary)', cursor: 'pointer', fontWeight: 600 }}>Terms and Agreement</span>
              </span>
            </label>
          )}
          </div>
          {isLogin && <div style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '14px' }}><span style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)', cursor: 'pointer' }}>Forgot password?</span></div>}
          <button onClick={handleSubmit} style={{ ...S.red, width: '100%', padding: '12px', fontSize: '14px', marginTop: '12px' }}>{isLogin ? 'Log in' : 'Register'}</button>
          {!isLogin && <p style={{ fontSize: '11px', color: 'var(--ontrack-text-muted)', textAlign: 'center', marginTop: '12px' }}></p>}
          <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: 'var(--ontrack-text-secondary)' }}>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <span onClick={onSwitch} style={{ color: 'var(--ontrack-primary)', cursor: 'pointer', fontWeight: 500 }}>{isLogin ? 'Register' : 'Log in'}</span>
          </p>
        </div>
      </div>
    </div>
  </div>
  )
}

// ─── Profile view ──────────────────────────────────────────────────────────────

function ProfileView({ user, onLogout, onSwitchAccount, onChangePassword, onChangeName, theme, onToggleTheme }: { user: User; onLogout: () => void; onSwitchAccount: () => void; onChangePassword: (c: string, n: string, co: string) => string | null; onChangeName: (f: string, l: string) => string | null; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [showConfirmNew, setShowConfirmNew] = useState(false)
  const [firstName, setFirstName] = useState(user.name.split(' ')[0] ?? '')
  const [lastName, setLastName] = useState(user.name.split(' ').slice(1).join(' ') ?? '')
  const [nameMsg, setNameMsg] = useState<{ text: string; ok: boolean } | null>(null)

  function saveName() {
    const err = onChangeName(firstName, lastName)
    if (err) setNameMsg({ text: err, ok: false })
    else { setNameMsg({ text: 'Name updated successfully.', ok: true }) }
  }

  function save() {
    const err = onChangePassword(current, next, confirm)
    if (err) setMsg({ text: err, ok: false })
    else { setMsg({ text: 'Password updated successfully.', ok: true }); setCurrent(''); setNext(''); setConfirm('') }
  }

  return (
    <div style={{ padding: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <Avatar name={user.name} size={56} color="var(--ontrack-primary)" />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{user.name}</div>
          <div style={{ fontSize: '13px', color: 'var(--ontrack-text-muted)' }}>{user.email}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: '300px' }}>
          <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '8px', padding: '18px 24px', maxWidth: '440px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px', color: 'var(--ontrack-text)' }}>Appearance</div>
              <div style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)' }}>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</div>
            </div>
            <button onClick={onToggleTheme} style={{ background: 'var(--ontrack-border)', border: '1px solid var(--ontrack-border)', borderRadius: '6px', padding: '8px 16px', color: 'var(--ontrack-text)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"></path></svg>
              )}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
          <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '8px', padding: '24px', maxWidth: '440px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '18px', color: 'var(--ontrack-text)' }}>Change Name</h3>
            {nameMsg && <div style={{ background: nameMsg.ok ? '#163326' : '#2a1515', border: `1px solid ${nameMsg.ok ? '#22c55e30' : 'var(--ontrack-primary)30'}`, borderRadius: '5px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: nameMsg.ok ? 'var(--ontrack-success)' : 'var(--ontrack-primary)' }}>{nameMsg.text}</div>}
            <label style={S.label}>First Name</label>
            <input style={S.input} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" />
            <label style={S.label}>Last Name</label>
            <input style={S.input} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" />
            <button style={{ ...S.red, width: '100%', marginTop: '12px' }} onClick={saveName}>Save Changes</button>
          </div>
        </div>
        <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '8px', padding: '24px', maxWidth: '440px', height: 'fit-content' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '18px', color: 'var(--ontrack-text)' }}>Change Password</h3>
          {msg && <div style={{ background: msg.ok ? '#163326' : '#2a1515', border: `1px solid ${msg.ok ? '#22c55e30' : 'var(--ontrack-primary)30'}`, borderRadius: '5px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: msg.ok ? 'var(--ontrack-success)' : 'var(--ontrack-primary)' }}>{msg.text}</div>}
          <label style={S.label}>Current Password</label>
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showCurrent ? "text" : "password"} value={current} onChange={e => setCurrent(e.target.value)} placeholder="••••••••" />
            <button type="button" onClick={() => setShowCurrent(!showCurrent)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ontrack-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            <button type="button" onClick={() => setShowNext(!showNext)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ontrack-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {showNext ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
              )}
            </button>
          </div>
          <label style={S.label}>Confirm New Password</label>
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <input style={{ ...S.input, paddingRight: '36px', marginBottom: 0 }} type={showConfirmNew ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
            <button type="button" onClick={() => setShowConfirmNew(!showConfirmNew)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ontrack-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {showConfirmNew ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.656 11.205A3.001 3.001 0 0012.012 10 3 3 0 006.343 14m3.85 3.85A7.15 7.15 0 0112 19a9.89 9.89 0 01-4.45-2.55M11 6.055a10.4 10.4 0 014.545 3.54M4.752 3.752l16.496 16.496"></path></svg>
              )}
            </button>
          </div>
          <button style={{ ...S.red, marginTop: '12px' }} onClick={save}>Save Changes</button>
        </div>
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
      <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '8px', padding: '24px', maxWidth: '500px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '18px', color: 'var(--ontrack-text)' }}>Room Settings</h3>
        <label style={S.label}>Project Title</label>
        <input style={S.input} value={title} onChange={e => setTitle(e.target.value)} />
        <label style={S.label}>Description</label>
        <textarea style={{ ...S.input, height: '80px', resize: 'none' }} value={desc} onChange={e => setDesc(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button style={{ ...S.red, marginTop: '12px' }} onClick={save}>Save Changes</button>
          {saved && <span style={{ fontSize: '13px', color: 'var(--ontrack-success)' }}>✓ Saved</span>}
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
  const componentGap = 200 // increased spacing between components

  if (tasks.length === 0) return {}

  const taskMap = new Map(tasks.map(t => [t.id, t]))

  const deps: Record<string, string[]> = {}
  tasks.forEach(t => {
    deps[t.id] = (taskDeps[t.id] ?? []).filter(id => taskMap.has(id))
  })

  const children: Record<string, string[]> = {}
  tasks.forEach(t => {
    children[t.id] = []
  })
  tasks.forEach(t => {
    deps[t.id].forEach(p => {
      if (children[p]) {
        children[p].push(t.id)
      }
    })
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

  const getAncestors = (id: string, visited = new Set<string>()): Set<string> => {
    if (visited.has(id)) return visited
    visited.add(id)
    deps[id].forEach(p => getAncestors(p, visited))
    return visited
  }

  const getDescendants = (id: string, visited = new Set<string>()): Set<string> => {
    if (visited.has(id)) return visited
    visited.add(id)
    children[id].forEach(c => getDescendants(c, visited))
    return visited
  }

  const taskIds = tasks.map(t => t.id)
  const visited = new Set<string>()
  const components: string[][] = []

  taskIds.forEach(id => {
    if (visited.has(id)) return
    const componentNodes = getDescendants(id, new Set())
    deps[id].forEach(p => {
      getDescendants(p, componentNodes)
    })
    const allConnected = new Set(componentNodes)
    getAncestors(id, allConnected)
    componentNodes.forEach(n => visited.add(n))
    if (allConnected.size > 0) {
      const comp = Array.from(allConnected).filter(x => taskMap.has(x))
      if (comp.length > 0) {
        const alreadyExists = components.some(c => c.length === comp.length && c.every(x => comp.includes(x)))
        if (!alreadyExists) components.push(comp)
      }
    } else {
      visited.add(id)
      components.push([id])
    }
  })

  if (components.length === 0) components.push(taskIds)

  components.sort((a, b) => {
    const minA = Math.min(...a.map(x => memo.get(x) ?? 0))
    const minB = Math.min(...b.map(x => memo.get(x) ?? 0))
    return minA - minB
  })

  const positions = new Map<string, { x: number; y: number }>()
  let componentOffsetX = startX

  components.forEach(comp => {
    const compTasks = comp.map(id => taskMap.get(id)!).filter(Boolean)
    const compGroups = new Map<number, Task[]>()
    compTasks.forEach(t => {
      const lvl = memo.get(t.id) ?? 0
      if (!compGroups.has(lvl)) compGroups.set(lvl, [])
      compGroups.get(lvl)!.push(t)
    })
    const compLevels = Array.from(compGroups.keys()).sort((a, b) => a - b)

    let componentWidth = 0
    compLevels.forEach(lvl => {
      const group = compGroups.get(lvl)!
      const width = group.length * nodeW + Math.max(0, group.length - 1) * hGap
      if (width > componentWidth) componentWidth = width
    })

    const compStartX = componentOffsetX
    compLevels.forEach(lvl => {
      const group = compGroups.get(lvl)!
      const y = startY + lvl * (nodeH + vGap)
      if (lvl === 0) {
        const totalWidth = group.length * nodeW + (group.length - 1) * hGap
        let x = compStartX + Math.max(0, (componentWidth - totalWidth) / 2)
        group.forEach(t => {
          positions.set(t.id, { x, y })
          x += nodeW + hGap
        })
      } else {
        const items = group.map(t => {
          const parentIds = deps[t.id].filter(pid => comp.includes(pid))
          if (parentIds.length === 0) return { id: t.id, idealX: compStartX }
          const parentXs = parentIds.map(pid => positions.get(pid)!.x + nodeW / 2)
          const avgX = parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length
          return { id: t.id, idealX: avgX - nodeW / 2 }
        })
        items.sort((a, b) => a.idealX - b.idealX)
        const groupWidth = group.length * nodeW + (group.length - 1) * hGap
        const groupCenterX = items.reduce((sum, item) => sum + item.idealX + nodeW / 2, 0) / group.length
        let currentX = Math.max(compStartX, groupCenterX - groupWidth / 2)
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
    componentOffsetX += componentWidth + componentGap
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
    <div style={{ background: 'var(--ontrack-bg)', border: '1px solid var(--ontrack-border)', borderRadius: '8px', overflow: 'auto' }}>
      <div style={{ position: 'relative', width: canvasW, height: canvasH, minHeight: 500 }}>
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width={canvasW} height={canvasH}>
          <defs>
            <marker id="arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill="var(--ontrack-text-muted)" />
            </marker>
          </defs>
          {edges.map((e: any) => {
            const cy = (e.y1 + e.y2) / 2
            return <path key={e.key} d={`M ${e.x1} ${e.y1} C ${e.x1} ${cy}, ${e.x2} ${cy}, ${e.x2} ${e.y2}`} fill="none" stroke="var(--ontrack-text-muted)" strokeWidth="1.5" markerEnd="url(#arr)" />
          })}
        </svg>
        {tasks.map(task => {
          const cfg = STATUS[task.status]
          const visible = statusFilter === 'all' || task.status === statusFilter
          return (
            <div key={task.id} onClick={() => onTaskClick(task)} style={{
              position: 'absolute', left: task.x, top: task.y, width: nodeW, minHeight: nodeH,
              background: visible ? cfg.nodeColor : 'var(--ontrack-border)',
              border: `2px solid ${visible ? cfg.nodeBorder : 'var(--ontrack-border)'}`,
              borderRadius: '10px', padding: '10px 14px', cursor: 'pointer',
              opacity: visible ? 1 : 0.18,
              transition: 'opacity 0.2s, transform 0.15s, box-shadow 0.15s',
              boxShadow: visible ? `0 2px 8px rgba(0,0,0,0.35)` : 'none',
            }}
              onMouseEnter={e => { if (visible) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.5)' } }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = visible ? '0 2px 8px rgba(0,0,0,0.35)' : 'none' }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: visible ? cfg.nodeText : 'var(--ontrack-text-muted)', lineHeight: 1.3, marginBottom: '3px' }}>{task.title}</div>
              <div style={{ fontSize: '10px', color: visible ? (cfg.nodeColor === '#ffffff' ? 'var(--ontrack-text-muted)' : `${cfg.nodeText}99`) : 'var(--ontrack-text-muted)' }}>
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

function ChatView({ messages, currentUserId, getUserName, chatInput, setChatInput, onSend, compact }: { messages: Message[]; currentUserId: string; getUserName: (id: string) => string; chatInput: string; setChatInput: (v: string) => void; onSend: () => void; compact?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: compact ? '100%' : 'calc(100vh - 168px)', minHeight: compact ? 0 : '400px' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {messages.map(m => {
          const mine = m.senderId === currentUserId
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', gap: '10px', alignItems: 'flex-end' }}>
              {!mine && <Avatar name={getUserName(m.senderId)} size={32} color="var(--ontrack-border)" />}
              <div style={{ maxWidth: '58%' }}>
                {!mine && <div style={{ fontSize: '11px', color: 'var(--ontrack-text-muted)', marginBottom: '4px' }}>{getUserName(m.senderId)}</div>}
                <div style={{ background: mine ? 'var(--ontrack-info)' : 'var(--ontrack-border)', padding: '10px 14px', borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px', fontSize: '14px', color: 'var(--ontrack-text)', lineHeight: 1.5, wordBreak: 'break-word', overflowWrap: 'break-word' }}>{m.text}</div>
                <div style={{ fontSize: '10px', color: 'var(--ontrack-text-muted)', marginTop: '3px', textAlign: mine ? 'right' : 'left' }}>{fmtTime(m.createdAt)}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: '14px 32px', borderTop: '1px solid var(--ontrack-border)', display: 'flex', gap: '10px' }}>
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
      <div style={{ background: 'var(--ontrack-surface)', border: '1px solid var(--ontrack-border)', borderRadius: '10px', padding: '28px', width: '100%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.7)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--ontrack-text-muted)', fontSize: '18px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
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
          <button key={c} onClick={() => setColor(c)} style={{ width: '32px', height: '32px', borderRadius: '50%', background: c, border: `2px solid ${color === c ? '#fff' : 'transparent'}`, cursor: 'pointer', padding: 0 }} />
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
      <p style={{ fontSize: '13px', color: 'var(--ontrack-text-muted)', marginBottom: '16px' }}>Ask your team leader for the room code.</p>
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
      setDeps((taskDeps[task.id] ?? []).filter(id => id !== task.id))
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
    console.debug('[CreateTaskModal.save] title:', title, 'deadline:', deadline, 'assigneeIds:', assigneeIds, 'deps:', deps, 'isEditing:', isEditing)
    if (!title.trim()) return
    validateDeadline(deadline)
    if (deadlineError) return
    let x: number, y: number
    if (task) {
      x = task.x
      y = task.y
    } else {
      x = 100
      y = 60
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
    console.debug('[CreateTaskModal.save] calling onSave with:', data)
    onSave(data, deps.filter(id => id !== task?.id))
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
      {isEditing && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '22px' }}>
          <button onClick={handleDelete} style={{ background: 'none', border: 'none', color: 'var(--ontrack-primary)', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>Delete</button>
        </div>
      )}
      <label style={S.label}>Task Title</label>
      <input style={S.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Backend API Setup" autoFocus />
      <label style={S.label}>Description</label>
      <textarea style={{ ...S.input, height: '70px', resize: 'none' }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="What needs to be done?" />
      <label style={S.label}>Assign To</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {members.map(m => (
          <button key={m.userId} onClick={() => setAssigneeIds(d => d.includes(m.userId) ? d.filter(x => x !== m.userId) : [...d, m.userId])}
            style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--ontrack-border)', fontSize: '12px', cursor: 'pointer', background: assigneeIds.includes(m.userId) ? 'var(--ontrack-primary)' : 'var(--ontrack-surface)', color: assigneeIds.includes(m.userId) ? '#fff' : 'var(--ontrack-text-secondary)' }}>
            {m.user.name} ({m.role})
          </button>
        ))}
      </div>
      <label style={S.label}>Deadline</label>
      <input type="date" style={{ ...S.input, borderColor: deadlineError ? 'var(--ontrack-primary)' : undefined }} value={deadline} onChange={e => handleDeadlineChange(e.target.value)} min={new Date().toISOString().split('T')[0]} />
      {deadlineError && <div style={{ color: 'var(--ontrack-primary)', fontSize: '12px', marginTop: '6px' }}>{deadlineError}</div>}
      {existingTasks.length > 0 && (
        <>
          <label style={S.label}>Dependencies (optional)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
            {existingTasks.filter(t => t.id !== task?.id).map(t => (
              <button key={t.id} onClick={() => setDeps(d => d.includes(t.id) ? d.filter(x => x !== t.id) : [...d, t.id])}
                style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--ontrack-border)', fontSize: '12px', cursor: 'pointer', background: deps.includes(t.id) ? 'var(--ontrack-primary)' : 'var(--ontrack-surface)', color: deps.includes(t.id) ? '#fff' : 'var(--ontrack-text-secondary)' }}>
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
      <div style={{ background: 'var(--ontrack-input-bg)', borderRadius: '6px', padding: '12px 14px', marginBottom: '18px' }}>
        <div style={{ fontWeight: 600, marginBottom: '3px' }}>{task.title}</div>
        <div style={{ fontSize: '12px', color: 'var(--ontrack-text-muted)' }}>Due: {task.deadline}</div>
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
      border: active && cfg ? `1.5px solid ${cfg.nodeBorder}` : active ? '1.5px solid var(--ontrack-primary)' : '1px solid var(--ontrack-border)',
      background: active && cfg ? cfg.pillBg : active ? 'var(--ontrack-primary)' : 'var(--ontrack-surface)',
      color: active && cfg ? cfg.pillText : active ? '#fff' : 'var(--ontrack-text-muted)',
      fontWeight: active ? 600 : 400, transition: 'all 0.15s',
      display: 'flex', alignItems: 'center', gap: '6px',
    }}>
      {cfg && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: active ? cfg.dot : 'var(--ontrack-text-muted)', flexShrink: 0 }} />}
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
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: active ? 'var(--ontrack-primary-tint)' : 'transparent', border: 'none', borderRadius: '5px', fontSize: '13px', color: dim ? 'var(--ontrack-text-muted)' : active ? 'var(--ontrack-primary)' : 'var(--ontrack-text-secondary)', cursor: 'pointer', marginBottom: '2px', fontFamily: 'Inter, sans-serif', fontWeight: active ? 600 : 400 }}>
      {label}
    </button>
  )
}

function DropItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', fontSize: '13px', color: danger ? 'var(--ontrack-primary)' : 'var(--ontrack-text-secondary)', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--ontrack-border)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
      {label}
    </button>
  )
}

function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--ontrack-surface-alt)', border: '1px solid var(--ontrack-border)', borderRadius: '6px', padding: '12px', marginBottom: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--ontrack-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '14px', color: 'var(--ontrack-text)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function Divider() {
  return <div style={{ height: '1px', background: 'var(--ontrack-border)', margin: '10px 8px' }} />
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ontrack-text-muted)', fontSize: '14px' }}>{text}</div>
}







