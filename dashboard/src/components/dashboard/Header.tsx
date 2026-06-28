'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Bot, RefreshCw, Sun, Moon, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import type { ConnectionState } from '@/lib/types'
import { formatTimestamp } from '@/lib/dashboard-api'

interface HeaderProps {
  connection: ConnectionState
  lastUpdated: number | null
  refreshing: boolean
  onRefresh: () => void
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const cfg = {
    connected: { color: 'bg-teal-500', ring: 'ring-teal-500/30', label: 'Connected' },
    connecting: { color: 'bg-amber-500', ring: 'ring-amber-500/30', label: 'Connecting' },
    disconnected: { color: 'bg-destructive', ring: 'ring-destructive/30', label: 'Disconnected' },
  }[state]
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex">
        <span className={cn('inline-block size-2.5 rounded-full', cfg.color)} />
        {state !== 'disconnected' && (
          <span
            className={cn(
              'absolute inline-flex size-2.5 animate-ping rounded-full opacity-75',
              cfg.color,
            )}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="sr-only">Bot status: {cfg.label}</span>
      <span
        className={cn(
          'text-xs font-medium',
          state === 'connected' && 'text-teal-500',
          state === 'connecting' && 'text-amber-500',
          state === 'disconnected' && 'text-destructive',
        )}
        aria-hidden="true"
      >
        {cfg.label}
      </span>
    </span>
  )
}

export function Header({ connection, lastUpdated, refreshing, onRefresh }: HeaderProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')

  return (
    <header
      className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"
      role="banner"
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        {/* Logo + name */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-3"
        >
          <div className="relative grid size-10 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 shadow-lg shadow-teal-500/20 sm:size-11">
            <Bot className="size-5 text-white sm:size-6" aria-hidden="true" />
            <span
              className="absolute -right-0.5 -top-0.5 inline-block size-2.5 rounded-full border-2 border-background bg-gold-500"
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight sm:text-lg">
                SkyBot <span className="text-teal-500">v2</span>
              </h1>
              <Badge
                variant="secondary"
                className="hidden border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 sm:inline-flex"
              >
                Railway Edition
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground sm:text-xs">
              Hypixel AH Flip Tracker &amp; TTS Console
            </p>
          </div>
        </motion.div>

        {/* Right side */}
        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-3 rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 sm:flex">
            <Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <ConnectionDot state={connection} />
            <span className="text-muted-foreground/40" aria-hidden="true">
              •
            </span>
            <span className="text-xs text-muted-foreground">
              Updated{' '}
              <span className="font-medium text-foreground">
                {lastUpdated ? formatTimestamp(lastUpdated) : '—'}
              </span>
            </span>
          </div>

          {/* Mobile connection badge */}
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1.5 sm:hidden">
            <ConnectionDot state={connection} />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            aria-label={mounted ? `Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode` : 'Switch theme'}
            className="h-9 w-9"
          >
            {mounted && resolvedTheme === 'dark' ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
          </Button>

          <Button
            variant="default"
            onClick={onRefresh}
            disabled={refreshing}
            className="gap-2 bg-teal-600 text-white shadow-sm hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 dark:text-teal-950"
            aria-label="Refresh dashboard data"
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden="true" />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
