import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useWebSocket } from './hooks/useWebSocket'
import Login from './pages/Login'
import Register from './pages/Register'
import Chats from './pages/Chats'
import MyRobots from './pages/MyRobots'
import RobotStore from './pages/RobotStore'
import AIChat from './pages/AIChat'
import Profile from './pages/Profile'
import SavedMessages from './pages/SavedMessages'
import ToastContainer from './components/ui/Toast'
import Onboarding from './components/Onboarding'
import TabBar from './components/TabBar'
import { registerServiceWorker, subscribeToPush } from './lib/pushNotifications'
import { useNotifications } from './hooks/useNotifications'

function App() {
  const { user, loading, checkAuth } = useAuthStore()
  const token = localStorage.getItem('token')
  const [showOnboarding, setShowOnboarding] = useState(false)

  useWebSocket(user ? token : null)
  // Initialize notification system (tab title badge, visibility tracking)
  useNotifications()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  // Apply saved theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme)
    }
  }, [])

  // Register service worker and request push permission
  useEffect(() => {
    if (user) {
      registerServiceWorker().then(() => {
        if (Notification.permission === 'default') {
          Notification.requestPermission().then(perm => {
            if (perm === 'granted') subscribeToPush().catch(() => {})
          })
        } else if (Notification.permission === 'granted') {
          subscribeToPush().catch(() => {})
        }
      })

      // Check if onboarding needed
      const oc = (user as any).onboardingCompleted
      if (oc === false || oc === 0 || oc === null || oc === undefined) {
        setShowOnboarding(true)
      }
    }
  }, [user])

  if (loading) {
    return (
      <>
        <ToastContainer />
        <div className="h-screen flex items-center justify-center bg-bg-primary">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-text-secondary">Loading Neva...</span>
          </div>
        </div>
      </>
    )
  }

  if (!user) {
    return (
      <>
        <ToastContainer />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </>
    )
  }

  return (
    <>
      <ToastContainer />
      {showOnboarding && <Onboarding onComplete={() => setShowOnboarding(false)} />}
      <Routes>
        <Route path="/" element={<Chats />} />
        <Route path="/robots" element={<MyRobots />} />
        <Route path="/store" element={<RobotStore />} />
        <Route path="/ai-chat" element={<AIChat />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/saved" element={<SavedMessages />} />
        {/* Redirects for old routes */}
        <Route path="/agents" element={<Navigate to="/robots" />} />
        <Route path="/marketplace" element={<Navigate to="/store" />} />
        <Route path="/triggers" element={<Navigate to="/robots" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <TabBar />
    </>
  )
}

export default App
