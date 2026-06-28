'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Copy,
  Check,
  Sparkles,
  Star,
  Hammer,
  RefreshCw,
  Flame,
  Book,
  Palette,
  PawPrint,
  Candy,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { Flip } from '@/lib/types'
import {
  formatCoins,
  formatCoinsFull,
  formatRelativeTime,
  tierColorHex,
} from '@/lib/dashboard-api'

interface FlipCardProps {
  flip: Flip
  /** Stable index — used for entrance animation stagger. */
  index?: number
}

/** Score pill — a tiny labeled progress bar (demand / volume / confidence). */
function ScoreBar({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: 'teal' | 'amber' | 'gold'
}) {
  const colorClass = {
    teal: '[&>[data-slot=progress-indicator]]:bg-teal-500',
    amber: '[&>[data-slot=progress-indicator]]:bg-amber-500',
    gold: '[&>[data-slot=progress-indicator]]:bg-gold-500',
  }[color]
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{Math.round(value)}</span>
      </div>
      <Progress value={Math.min(100, Math.max(0, value))} className={cn('h-1.5', colorClass)} />
    </div>
  )
}

function AttributeBadge({
  icon: Icon,
  children,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  color: string
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1 border-transparent px-1.5 py-0 text-[10px] font-medium',
        color,
      )}
    >
      <Icon className="size-2.5" aria-hidden="true" />
      {children}
    </Badge>
  )
}

function CopyableAuctionUUID({ uuid }: { uuid: string }) {
  const [copied, setCopied] = React.useState(false)
  const cmd = `/viewauction ${uuid}`

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback — select the text node for manual copy
      const el = document.getElementById(`uuid-${uuid}`)
      ;(el as HTMLInputElement | null)?.select?.()
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="group flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-left font-mono text-[11px] transition-colors hover:border-teal-500/40 hover:bg-teal-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Copy auction command ${cmd}`}
      title="Click to copy"
    >
      <span className="truncate text-muted-foreground" id={`uuid-${uuid}`}>
        <span className="text-teal-500">$</span> {cmd}
      </span>
      {copied ? (
        <Check className="ml-auto size-3.5 shrink-0 text-teal-500" aria-hidden="true" />
      ) : (
        <Copy className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      )}
    </button>
  )
}

export function FlipCard({ flip, index = 0 }: FlipCardProps) {
  const { attributes: a } = flip
  const tierHex = tierColorHex(a.tier)
  const isHighProfit = flip.profit >= 5_000_000

  const attrBadges: React.ReactNode[] = []
  if (a.isPet) {
    attrBadges.push(
      <AttributeBadge key="pet" icon={PawPrint} color="bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300">
        Pet Lvl {a.petLevel}
      </AttributeBadge>,
    )
    if (a.petCandy > 0) {
      attrBadges.push(
        <AttributeBadge key="candy" icon={Candy} color="bg-pink-500/15 text-pink-600 dark:text-pink-300">
          🍬 {a.petCandy}
        </AttributeBadge>,
      )
    }
  }
  if (a.stars > 0) {
    attrBadges.push(
      <AttributeBadge key="stars" icon={Star} color="bg-gold-500/15 text-gold-600 dark:text-gold-300">
        {'✪'.repeat(Math.min(5, a.stars))} ({a.stars})
      </AttributeBadge>,
    )
  }
  if (a.reforge) {
    attrBadges.push(
      <AttributeBadge key="reforge" icon={Hammer} color="bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
        {a.reforge}
      </AttributeBadge>,
    )
  }
  if (a.isRecombobulated) {
    attrBadges.push(
      <AttributeBadge key="recomb" icon={RefreshCw} color="bg-violet-500/15 text-violet-600 dark:text-violet-300">
        Recomb
      </AttributeBadge>,
    )
  }
  if (a.hotPotatoBooks > 0) {
    attrBadges.push(
      <AttributeBadge key="hpb" icon={Flame} color="bg-amber-500/15 text-amber-600 dark:text-amber-300">
        HPB {a.hotPotatoBooks}
      </AttributeBadge>,
    )
  }
  if (a.farmingForDummies > 0) {
    attrBadges.push(
      <AttributeBadge key="ffd" icon={Book} color="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
        FFD {a.farmingForDummies}
      </AttributeBadge>,
    )
  }
  if (a.isShiny) {
    attrBadges.push(
      <AttributeBadge key="shiny" icon={Sparkles} color="bg-gold-500/20 text-gold-600 dark:text-gold-300">
        Shiny{a.shinyValue != null ? ` (${a.shinyValue.toLocaleString()})` : ''}
      </AttributeBadge>,
    )
  }
  if (a.skin) {
    attrBadges.push(
      <AttributeBadge key="skin" icon={Palette} color="bg-teal-500/15 text-teal-600 dark:text-teal-300">
        {a.skin.length > 18 ? `${a.skin.slice(0, 18)}…` : a.skin}
      </AttributeBadge>,
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4) }}
      whileHover={{ y: -2 }}
    >
      <Card
        className={cn(
          'relative overflow-hidden gap-0 p-0 py-0 shadow-sm transition-shadow hover:shadow-md',
          isHighProfit && 'ring-1 ring-gold-500/30',
        )}
      >
        {/* Rarity color stripe */}
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: tierHex }}
          aria-hidden="true"
        />

        <div className="space-y-3 p-3 pl-4 sm:p-4 sm:pl-5">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-sm font-bold leading-tight sm:text-base"
                title={a.name}
              >
                {a.name}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="border-border/60 px-1.5 py-0 text-[10px] font-semibold uppercase"
                  style={{ color: tierHex }}
                >
                  {a.tier || 'UNKNOWN'}
                </Badge>
                {a.isBin && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    BIN
                  </Badge>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {formatRelativeTime(flip.detectedAt)}
                </span>
              </div>
            </div>

            {/* Profit (gold, large) */}
            <div className="shrink-0 text-right">
              <div
                className={cn(
                  'text-lg font-bold tabular-nums leading-none sm:text-xl',
                  'text-gold-600 dark:text-gold-400',
                )}
                title={`${formatCoinsFull(flip.profit)} coins profit`}
              >
                +{formatCoins(flip.profit)}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                profit
              </div>
              <div className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                +{flip.marginPct.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Buy / EWMA / Profit row */}
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/50 bg-muted/30 p-2 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Buy
              </div>
              <div className="text-sm font-semibold tabular-nums" title={formatCoinsFull(flip.buyPrice)}>
                {formatCoins(flip.buyPrice)}
              </div>
            </div>
            <div className="border-x border-border/50">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Market EWMA
              </div>
              <div className="text-sm font-semibold tabular-nums text-teal-600 dark:text-teal-400" title={formatCoinsFull(flip.marketEwma)}>
                {formatCoins(flip.marketEwma)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                P5 Floor
              </div>
              <div className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400" title={formatCoinsFull(flip.marketP5)}>
                {formatCoins(flip.marketP5)}
              </div>
            </div>
          </div>

          {/* Attribute badges */}
          {attrBadges.length > 0 && (
            <div className="flex flex-wrap gap-1">{attrBadges}</div>
          )}

          {/* Score bars */}
          <div className="grid grid-cols-3 gap-2">
            <ScoreBar label="Demand" value={flip.demandScore} color="amber" />
            <ScoreBar label="Volume" value={flip.volumeScore} color="teal" />
            <ScoreBar label="Confidence" value={flip.confidenceScore} color="gold" />
          </div>

          {/* Copyable auction UUID */}
          <CopyableAuctionUUID uuid={flip.uuid} />
        </div>
      </Card>
    </motion.div>
  )
}
