'use client'

import * as React from 'react'
import { Header } from './Header'
import { Footer } from './Footer'
import { StatsCards } from './StatsCards'
import { FlipFeed } from './FlipFeed'
import { TopFlipsLeaderboard } from './TopFlipsLeaderboard'
import { TTSSessions } from './TTSSessions'
import { PriceLookup } from './PriceLookup'
import { SubscriptionsManager } from './SubscriptionsManager'
import { BotConfigPanel } from './BotConfig'
import { SetupChecklist } from './SetupChecklist'
import { FlipWatcherControls } from './FlipWatcherControls'
import { LinkedPlayers } from './LinkedPlayers'
import { AuctionSoldPanel } from './AuctionSoldPanel'
import { LaunchPanel } from './LaunchPanel'
import { CarrySystemPanel } from './CarrySystemPanel'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'
import type {
  ApiError,
  AuctionSoldStats,
  BotStats,
  ConnectionState,
  EditableConfig,
  Flip,
  FirstRunStatus,
  LinkedPlayer,
  Subscription,
  TTSSession,
} from '@/lib/types'
import {
  checkHealth,
  deriveFirstRunStatus,
  fetchAuctionSoldStats,
  fetchConfig,
  fetchLinkedPlayers,
  fetchRecentFlips,
  fetchStats,
  fetchSubscriptions,
  fetchTopFlips,
  fetchTTSSessions,
} from '@/lib/dashboard-api'

const POLL_INTERVAL_MS = 10_000

interface State<T> {
  data: T | null
  loading: boolean
  error: ApiError | null
  lastUpdated: number | null
}

function initState<T>(initial: T | null = null): State<T> {
  return { data: initial, loading: true, error: null, lastUpdated: null }
}

export function DashboardClient() {
  // Connection state — derived from health probe
  const [connection, setConnection] = React.useState<ConnectionState>('connecting')

  // Per-section state
  const [stats, setStats] = React.useState<State<BotStats>>(initState<BotStats>())
  const [recentFlips, setRecentFlips] = React.useState<State<Flip[]>>(initState<Flip[]>([]))
  const [topFlips, setTopFlips] = React.useState<State<Flip[]>>(initState<Flip[]>([]))
  const [ttsSessions, setTtsSessions] = React.useState<State<TTSSession[]>>(initState<TTSSession[]>([]))
  const [subscriptions, setSubscriptions] = React.useState<State<Subscription[]>>(initState<Subscription[]>([]))
  const [config, setConfig] = React.useState<State<EditableConfig>>(initState<EditableConfig>())
  const [linkedPlayers, setLinkedPlayers] = React.useState<State<LinkedPlayer[]>>(initState<LinkedPlayer[]>([]))
  const [auctionSold, setAuctionSold] = React.useState<State<AuctionSoldStats>>(initState<AuctionSoldStats>())

  // Live feed control
  const [paused, setPaused] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [lastPollAt, setLastPollAt] = React.useState<number | null>(null)

  // Track in-flight requests to avoid overlapping polls
  const inflightRef = React.useRef<Set<string>>(new Set())

  // Generic fetch wrapper that updates a state slot
  const runFetch = React.useCallback(
    async function <T>(
      key: string,
      stateSetter: React.Dispatch<React.SetStateAction<State<T>>>,
      fetcher: () => Promise<T>,
      opts?: { silent?: boolean },
    ): Promise<T | null> {
      if (inflightRef.current.has(key)) return null
      inflightRef.current.add(key)
      // Set loading=true only if we have no prior data
      stateSetter((prev) =>
        prev.data === null ? { ...prev, loading: true } : { ...prev, loading: false },
      )
      try {
        const data = await fetcher()
        stateSetter({
          data,
          loading: false,
          error: null,
          lastUpdated: Date.now(),
        })
        return data
      } catch (e) {
        const err = e as ApiError
        stateSetter((prev) => ({
          ...prev,
          loading: false,
          error: err,
          lastUpdated: prev.lastUpdated,
        }))
        if (!opts?.silent) {
          // Connection downgrade
          setConnection('disconnected')
        }
        return null
      } finally {
        inflightRef.current.delete(key)
      }
    },
    [],
  )

  // ── Primary poll loop: health + stats + recent flips ──────────────
  const pollCore = React.useCallback(async () => {
    if (paused) return

    // Health check first — gates the rest
    let healthOk = false
    try {
      await checkHealth()
      healthOk = true
      setConnection('connected')
    } catch {
      setConnection('disconnected')
      // Mark the stats as errored so the UI shows the offline state
      setStats((prev) => ({
        ...prev,
        loading: false,
        error: prev.error ?? {
          message: 'Bot is offline or unreachable on port 8080.',
          endpoint: '/health',
        },
      }))
      return
    }

    if (!healthOk) return

    await Promise.all([
      runFetch('stats', setStats, fetchStats, { silent: true }),
      runFetch('recentFlips', setRecentFlips, () => fetchRecentFlips(20), { silent: true }),
    ])

    setLastPollAt(Date.now())
  }, [paused, runFetch])

  // ── Secondary poll: refresh top flips + TTS sessions + subscriptions ──
  // Less frequent — every ~30s.
  const pollSecondary = React.useCallback(async () => {
    await Promise.all([
      runFetch('topFlips', setTopFlips, () => fetchTopFlips(10), { silent: true }),
      runFetch('ttsSessions', setTtsSessions, fetchTTSSessions, { silent: true }),
      runFetch('subscriptions', setSubscriptions, fetchSubscriptions, { silent: true }),
      runFetch('linkedPlayers', setLinkedPlayers, async () => {
        const r = await fetchLinkedPlayers()
        return r.players ?? []
      }, { silent: true }),
      runFetch('auctionSold', setAuctionSold, fetchAuctionSoldStats, { silent: true }),
    ])
  }, [runFetch])

  // ── Initial load: everything ──────────────────────────────────────
  const loadAll = React.useCallback(async () => {
    setRefreshing(true)
    setConnection('connecting')

    let healthOk = false
    try {
      await checkHealth()
      healthOk = true
      setConnection('connected')
    } catch {
      setConnection('disconnected')
    }

    if (healthOk) {
      await Promise.all([
        runFetch('stats', setStats, fetchStats),
        runFetch('recentFlips', setRecentFlips, () => fetchRecentFlips(20)),
        runFetch('topFlips', setTopFlips, () => fetchTopFlips(10)),
        runFetch('ttsSessions', setTtsSessions, fetchTTSSessions),
        runFetch('subscriptions', setSubscriptions, fetchSubscriptions),
        runFetch('config', setConfig, fetchConfig),
        runFetch('linkedPlayers', setLinkedPlayers, async () => {
          const r = await fetchLinkedPlayers()
          return r.players ?? []
        }),
        runFetch('auctionSold', setAuctionSold, fetchAuctionSoldStats),
      ])
      setLastPollAt(Date.now())
    } else {
      // Mark all sections errored so they show the retry UI
      const err: ApiError = {
        message: 'Bot is offline or unreachable on port 8080.',
        endpoint: '/health',
      }
      setStats({ data: null, loading: false, error: err, lastUpdated: null })
      setRecentFlips({ data: [], loading: false, error: err, lastUpdated: null })
      setTopFlips({ data: [], loading: false, error: err, lastUpdated: null })
      setTtsSessions({ data: [], loading: false, error: err, lastUpdated: null })
      setSubscriptions({ data: [], loading: false, error: err, lastUpdated: null })
      setConfig({ data: null, loading: false, error: err, lastUpdated: null })
      setLinkedPlayers({ data: [], loading: false, error: err, lastUpdated: null })
      setAuctionSold({ data: null, loading: false, error: err, lastUpdated: null })
    }

    setRefreshing(false)
  }, [runFetch])

  // Initial mount — load everything
  React.useEffect(() => {
    loadAll()
  }, [loadAll])

  // Primary poll loop — every POLL_INTERVAL_MS
  React.useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      pollCore().catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [pollCore, paused])

  // Secondary poll loop — every 30s
  React.useEffect(() => {
    const id = setInterval(() => {
      pollSecondary().catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [pollSecondary])

  // Re-render every 30s so relative timestamps ("2m ago") update
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const handleRefresh = React.useCallback(() => {
    loadAll()
  }, [loadAll])

  /** Mutation-aware refetch — used after config saves / scans / redeployments.
   *  Refetches stats + config (cheap) so badges and overrides stay in sync. */
  const handleMutated = React.useCallback(() => {
    Promise.all([
      runFetch('stats', setStats, fetchStats, { silent: true }),
      runFetch('config', setConfig, fetchConfig, { silent: true }),
      runFetch('linkedPlayers', setLinkedPlayers, async () => {
        const r = await fetchLinkedPlayers()
        return r.players ?? []
      }, { silent: true }),
      runFetch('auctionSold', setAuctionSold, fetchAuctionSoldStats, { silent: true }),
    ]).catch(() => {})
  }, [runFetch])

  // Determine last-updated timestamp — use the most recent of all sections
  const lastUpdated = React.useMemo(() => {
    const ts = [
      stats.lastUpdated,
      recentFlips.lastUpdated,
      topFlips.lastUpdated,
      ttsSessions.lastUpdated,
      subscriptions.lastUpdated,
      config.lastUpdated,
      linkedPlayers.lastUpdated,
      auctionSold.lastUpdated,
    ].filter((x): x is number => x != null)
    return ts.length ? Math.max(...ts) : null
  }, [stats, recentFlips, topFlips, ttsSessions, subscriptions, config, linkedPlayers, auctionSold])

  const isOffline = connection === 'disconnected' && !stats.data

  // Derive the first-run status snapshot from the latest stats
  const firstRunStatus: FirstRunStatus | null = React.useMemo(
    () => deriveFirstRunStatus(stats.data),
    [stats.data],
  )

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header
        connection={connection}
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      <main
        className="skybot-grid-bg mx-auto w-full max-w-[1600px] flex-1 space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6"
        role="main"
      >
        {/* Offline banner */}
        {isOffline && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-destructive">
                  SkyBot is offline or unreachable
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The dashboard couldn&apos;t connect to the bot on port 8080. The
                  bot may still be starting up, deployed without a token, or
                  crashed. Check the Railway logs and try again.
                </p>
              </div>
            </div>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              className="shrink-0 gap-2"
            >
              <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
              Retry connection
            </Button>
          </motion.div>
        )}

        {/* 1. First-run setup checklist — top of the dashboard */}
        <SetupChecklist
          status={firstRunStatus}
          loading={stats.loading && !firstRunStatus}
          error={stats.error && !firstRunStatus ? stats.error : null}
          onMutated={handleMutated}
        />

        {/* 1b. Launch panel — the prominent "Start Bot" control center.
             Sits right under the SetupChecklist so the admin sees the
             deployment readiness snapshot + token validator + .env copy
             button before scrolling into runtime stats. */}
        <LaunchPanel onMutated={handleMutated} />

        {/* 2. Stats overview — now 6 cards */}
        <StatsCards
          stats={stats.data}
          loading={stats.loading}
          error={stats.error}
          onRetry={handleRefresh}
        />

        {/* 3. Flip watcher controls — force-scan + test-post */}
        <FlipWatcherControls
          stats={stats.data}
          loading={stats.loading && !stats.data}
          error={stats.error}
          onMutated={handleMutated}
        />

        {/* 4. Live flip feed — main feature */}
        <FlipFeed
          flips={recentFlips.data ?? []}
          loading={recentFlips.loading}
          error={recentFlips.error}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          onRetry={handleRefresh}
          pollIntervalMs={POLL_INTERVAL_MS}
          lastPollMs={lastPollAt}
        />

        {/* 5. Two-column grid: leaderboard + linked players */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <TopFlipsLeaderboard
            flips={topFlips.data ?? []}
            loading={topFlips.loading}
            error={topFlips.error}
            onRetry={handleRefresh}
          />
          <LinkedPlayers
            players={linkedPlayers.data ?? []}
            loading={linkedPlayers.loading}
            error={linkedPlayers.error}
            onRetry={handleRefresh}
          />
        </div>

        {/* 6. Two-column grid: TTS sessions + auction sold */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <TTSSessions
            sessions={ttsSessions.data ?? []}
            loading={ttsSessions.loading}
            error={ttsSessions.error}
            onRetry={handleRefresh}
          />
          <AuctionSoldPanel
            stats={auctionSold.data}
            loading={auctionSold.loading}
            error={auctionSold.error}
            onRetry={handleRefresh}
          />
        </div>

        {/* 7. Two-column grid: price lookup + subscriptions */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <PriceLookup />
          <SubscriptionsManager
            subscriptions={subscriptions.data ?? []}
            loading={subscriptions.loading}
            error={subscriptions.error}
            onRetry={handleRefresh}
            onMutated={handleRefresh}
          />
        </div>

        {/* 8. Editable bot config — full width */}
        <BotConfigPanel
          config={config.data}
          loading={config.loading}
          error={config.error}
          onRetry={handleRefresh}
          onMutated={handleMutated}
        />

        {/* 9. Carry system — full-width admin panel for the 5 carry categories */}
        <CarrySystemPanel />
      </main>

      <Footer />
    </div>
  )
}
