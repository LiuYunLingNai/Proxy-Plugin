import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { addCollection } from '@iconify/react'
import lucide from './icons.json'
import { ProxyPage } from './pages/ProxyPage'
import { ToastProvider } from './components/ToastProvider'
import { ToastContainer } from './components/ToastContainer'
import { Button } from './ui'
import { Icon } from '@iconify/react'
import { ConnectionsPage, LogsPage } from './pages/DataPages'
import { RulesPage } from './pages/RulesPage'
import { ProxiesPage } from './pages/ProxiesPage'
import { ConfigPage } from './pages/ConfigPage'
import './index.css'

addCollection(lucide)

const navigation = [
  { id: 'home', label: '主页', icon: 'lucide:house' },
  { id: 'proxies', label: '代理', icon: 'lucide:wifi' },
  { id: 'connections', label: '连接', icon: 'lucide:arrow-left-right' },
  { id: 'logs', label: '日志', icon: 'lucide:file-text' },
  { id: 'rules', label: '规则', icon: 'lucide:list-filter' },
  { id: 'subscriptions', label: '订阅', icon: 'lucide:layers-3' },
  { id: 'config', label: '配置', icon: 'lucide:settings-2' },
] as const
type View = (typeof navigation)[number]['id']

function ConsoleLayout() {
  const [view, setView] = useState<View>(() => {
    const saved = sessionStorage.getItem('proxy-plugin-page')
    return navigation.find(item => item.id === saved)?.id || 'home'
  })
  const [dark, setDark] = useState(() => localStorage.getItem('proxy-plugin-theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  useEffect(() => {
    sessionStorage.setItem('proxy-plugin-page', view)
  }, [view])

  return (
    <>
      <div className="app-backdrop mode-solid" aria-hidden />
      <aside className="border-b border-divider bg-card md:fixed md:inset-y-0 md:left-0 md:z-20 md:flex md:w-56 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 px-5 py-5 md:px-6 md:py-8">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Icon icon="lucide:waypoints" className="size-5 text-primary" />
            Proxy-Plugin
          </span>
          <Button
            size="icon-sm"
            className="md:hidden"
            aria-label={dark ? '切换浅色' : '切换深色'}
            icon={dark ? 'lucide:sun' : 'lucide:moon'}
            onClick={() => {
              const next = !dark
              setDark(next)
              localStorage.setItem('proxy-plugin-theme', next ? 'dark' : 'light')
            }}
          />
        </div>
        <nav
          aria-label="控制台导航"
          className="grid grid-cols-3 gap-1 px-3 pb-3 md:flex md:flex-col md:gap-2 md:px-4"
        >
          {navigation.map(item => (
            <button
              key={item.id}
              type="button"
              data-nav={item.id}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => setView(item.id)}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-medium transition-colors md:justify-start md:gap-4 md:px-5 md:py-4 ${view === item.id ? 'bg-primary-soft text-primary-soft-foreground' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}`}
            >
              <Icon icon={item.icon} className="size-4 shrink-0 md:size-5" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden px-5 py-6 md:block">
          <Button
            size="sm"
            variant="ghost"
            icon={dark ? 'lucide:sun' : 'lucide:moon'}
            onClick={() => {
              const next = !dark
              setDark(next)
              localStorage.setItem('proxy-plugin-theme', next ? 'dark' : 'light')
            }}
          >
            {dark ? '浅色' : '深色'}
          </Button>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:ml-56 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">
          {view === 'proxies' ? (
            <ProxiesPage />
          ) : view === 'config' ? (
            <ConfigPage />
          ) : view === 'connections' ? (
            <ConnectionsPage />
          ) : view === 'logs' ? (
            <LogsPage />
          ) : view === 'rules' ? (
            <RulesPage />
          ) : (
            <ProxyPage view={view} />
          )}
        </div>
      </main>
      <ToastContainer />
    </>
  )
}

function App() {
  return (
    <ToastProvider>
      <ConsoleLayout />
    </ToastProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
