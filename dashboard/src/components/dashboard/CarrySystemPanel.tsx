'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Castle,
  Hash,
  Save,
  Send,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Search,
  Server,
  Tag,
  Power,
  Inbox,
  CheckCircle2,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type {
  ApiError,
  CarryCategory,
  CarryItem,
} from '@/lib/types'
import {
  fetchCarryCategories,
  postCarryPanel,
  setCarryChannel,
  setCarryItemPrice,
  toggleCarryItem,
} from '@/lib/dashboard-api'

interface CarrySystemPanelProps {
  /** Optional initial guild ID — useful when the parent already knows it. */
  defaultGuildId?: string
}

/**
 * CarrySystemPanel — admin control surface for the SkyBot v2 carry system.
 *
 * Mirrors the Skyblock Maniacs screenshot design: one card per category
 * (🏰 Dungeons, ⭐ Master Mode, 👹 Slayers, 🐉 Kuudra, 🔥 Crimson) with:
 *   - A Discord channel binding input (where the panel gets posted)
 *   - A "Post Panel" button that triggers POST /api/carry/panel
 *   - A live table of items with inline price edits + enable/disable toggles
 *
 * Because the dashboard is bot-wide, the admin must supply a guild ID at the
 * top. Carry config is per-guild (each Discord server can have its own
 * channels, prices, and enabled items).
 */
export function CarrySystemPanel({ defaultGuildId = '' }: CarrySystemPanelProps) {
  const [guildId, setGuildId] = React.useState(defaultGuildId)
  const [draftGuildId, setDraftGuildId] = React.useState(defaultGuildId)
  const [activeGuildId, setActiveGuildId] = React.useState(defaultGuildId)

  const [categories, setCategories] = React.useState<Record<string, CarryCategory> | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [postingId, setPostingId] = React.useState<string | null>(null)

  const load = React.useCallback(async (gid: string) => {
    if (!gid) {
      setCategories(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetchCarryCategories(gid)
      setCategories(res.categories ?? {})
    } catch (e) {
      const err = e as ApiError
      setError(err)
      setCategories(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-load whenever the active guild id changes
  React.useEffect(() => {
    load(activeGuildId)
  }, [activeGuildId, load])

  const onApplyGuild = () => {
    const id = draftGuildId.trim()
    if (!id) {
      toast.error('Enter a guild ID first')
      return
    }
    if (!/^\d{15,20}$/.test(id)) {
      toast.error('Guild ID must be a numeric snowflake (15-20 digits)')
      return
    }
    setGuildId(id)
    setActiveGuildId(id)
    toast.success('Loaded carry config for guild ' + id)
  }

  const onResetGuild = () => {
    setDraftGuildId('')
    setGuildId('')
    setActiveGuildId('')
    setCategories(null)
    setError(null)
  }

  const onRefresh = () => {
    if (activeGuildId) load(activeGuildId)
  }

  // ── Mutations ──────────────────────────────────────────────────

  const handleChannelSave = async (categoryId: string, channelId: string) => {
    if (!activeGuildId) return
    if (channelId && !/^\d{15,20}$/.test(channelId)) {
      toast.error('Channel ID must be a numeric snowflake (15-20 digits)')
      return
    }
    try {
      await setCarryChannel(activeGuildId, categoryId, channelId)
      toast.success(`Channel saved for ${categoryId}`, {
        description: channelId
          ? 'Next Post Panel will land in the new channel.'
          : 'Channel cleared — Post Panel will be disabled until you set a new one.',
      })
      // Optimistically update local state
      setCategories((prev) => {
        if (!prev || !prev[categoryId]) return prev
        return {
          ...prev,
          [categoryId]: { ...prev[categoryId], channelId },
        }
      })
    } catch (e) {
      const err = e as ApiError
      toast.error('Failed to save channel', { description: err.message })
    }
  }

  const handlePriceSave = async (itemId: string, price: string) => {
    if (!activeGuildId) return
    if (!price.trim()) {
      toast.error('Price cannot be empty')
      return
    }
    try {
      const res = await setCarryItemPrice(activeGuildId, itemId, price.trim())
      if (res.ok && res.item) {
        toast.success(`Price updated: ${res.item.emoji} ${res.item.label}`, {
          description: `Now ${res.item.price} coins`,
        })
        // Update the local state for the matching item
        setCategories((prev) => {
          if (!prev) return prev
          const next: Record<string, CarryCategory> = {}
          for (const [cid, cat] of Object.entries(prev)) {
            const items = cat.items.map((it) =>
              it.id === itemId ? { ...it, price: res.item!.price } : it,
            )
            next[cid] = { ...cat, items }
          }
          return next
        })
      } else {
        toast.error('Failed to update price', { description: res.error })
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Failed to update price', { description: err.message })
    }
  }

  const handleToggle = async (itemId: string, enabled: boolean) => {
    if (!activeGuildId) return
    try {
      const res = await toggleCarryItem(activeGuildId, itemId, enabled)
      if (res.ok && res.item) {
        toast.success(
          `${res.item.emoji} ${res.item.label} ${enabled ? 'enabled' : 'disabled'}`,
        )
        setCategories((prev) => {
          if (!prev) return prev
          const next: Record<string, CarryCategory> = {}
          for (const [cid, cat] of Object.entries(prev)) {
            const items = cat.items.map((it) =>
              it.id === itemId ? { ...it, enabled } : it,
            )
            next[cid] = { ...cat, items }
          }
          return next
        })
      } else {
        toast.error('Failed to toggle item', { description: res.error })
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Failed to toggle item', { description: err.message })
    }
  }

  const handlePostPanel = async (categoryId: string) => {
    if (!activeGuildId) return
    setPostingId(categoryId)
    try {
      const res = await postCarryPanel(activeGuildId, categoryId)
      if (res.ok) {
        toast.success('Panel posted', {
          description: `Message ${res.messageId} sent to <#${res.channelId}>`,
        })
      } else {
        toast.error('Could not post panel', {
          description: res.error ?? 'Set a channel for this category first.',
        })
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Could not post panel', { description: err.message })
    } finally {
      setPostingId(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  const categoryList = categories ? Object.values(categories) : []
  const totalItems = categoryList.reduce((n, c) => n + (c.items?.length ?? 0), 0)
  const enabledItems = categoryList.reduce(
    (n, c) => n + (c.items?.filter((i) => i.enabled).length ?? 0),
    0,
  )
  const boundChannels = categoryList.filter((c) => c.channelId).length

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="overflow-hidden border-teal-500/25 shadow-sm shadow-teal-500/5">
        <CardHeader className="gap-3 border-b border-border/60 bg-gradient-to-br from-teal-500/5 via-transparent to-gold-500/5 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-teal-500/15 text-xl ring-1 ring-teal-500/30">
                <span aria-hidden="true">🏰</span>
              </div>
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
                  Carry System
                  {activeGuildId && (
                    <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 text-teal-600 dark:text-teal-400">
                      <Server className="size-3" aria-hidden="true" />
                      Guild {activeGuildId.slice(-6)}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  Configure carry categories, channels, and prices for your Discord server.
                </CardDescription>
              </div>
            </div>
            {categories && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="gap-1">
                  <Tag className="size-3 text-teal-500" aria-hidden="true" />
                  {enabledItems}/{totalItems} items
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Hash className="size-3 text-gold-500" aria-hidden="true" />
                  {boundChannels}/{categoryList.length} channels
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onRefresh}
                  disabled={loading}
                  className="h-7 gap-1.5 px-2 text-xs"
                  aria-label="Refresh carry categories"
                >
                  <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
                  Refresh
                </Button>
              </div>
            )}
          </div>

          {/* Guild ID selector */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="carry-guild-id"
                className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
              >
                <Server className="size-3" aria-hidden="true" />
                Discord Guild ID
              </label>
              <Input
                id="carry-guild-id"
                value={draftGuildId}
                onChange={(e) => setDraftGuildId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onApplyGuild()
                }}
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
                className="h-9 font-mono text-sm"
                aria-label="Discord guild ID to configure"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={onApplyGuild}
                disabled={loading || draftGuildId.trim() === activeGuildId}
                className="h-9 gap-1.5 bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 dark:text-teal-950"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="size-3.5" aria-hidden="true" />
                )}
                Load
              </Button>
              {activeGuildId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onResetGuild}
                  className="h-9 gap-1.5"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4 sm:p-6">
          {/* Empty state — no guild ID entered */}
          {!activeGuildId && !loading && !error && (
            <EmptyState
              icon={<Castle className="size-6" aria-hidden="true" />}
              title="Enter a guild ID above to configure carry categories"
              description="The dashboard is bot-wide, so each Discord server has its own carry channels, prices, and item toggles. Find the guild ID via Discord's Developer Mode (right-click → Copy ID)."
            />
          )}

          {/* Loading skeleton */}
          {loading && !categories && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Error state */}
          {error && !categories && (
            <div
              className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center"
              role="alert"
            >
              <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-destructive">Couldn&apos;t load carry categories</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{error.message}</p>
              </div>
              <Button size="sm" variant="outline" onClick={onRefresh} className="gap-1.5">
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Retry
              </Button>
            </div>
          )}

          {/* Category cards */}
          {categories && categoryList.length > 0 && (
            <div className="space-y-4">
              {categoryList.map((cat, i) => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  index={i}
                  posting={postingId === cat.id}
                  onChannelSave={(channelId) => handleChannelSave(cat.id, channelId)}
                  onPriceSave={handlePriceSave}
                  onToggle={handleToggle}
                  onPostPanel={() => handlePostPanel(cat.id)}
                />
              ))}
            </div>
          )}

          {/* Loaded but empty categories object */}
          {categories && categoryList.length === 0 && !loading && (
            <EmptyState
              icon={<Inbox className="size-6" aria-hidden="true" />}
              title="No carry categories returned"
              description="The bot responded with an empty catalog. Check that the bot is running a build with the carry system enabled."
            />
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Category card ──────────────────────────────────────────────

interface CategoryCardProps {
  category: CarryCategory
  index: number
  posting: boolean
  onChannelSave: (channelId: string) => void
  onPriceSave: (itemId: string, price: string) => void
  onToggle: (itemId: string, enabled: boolean) => void
  onPostPanel: () => void
}

function CategoryCard({
  category,
  index,
  posting,
  onChannelSave,
  onPriceSave,
  onToggle,
  onPostPanel,
}: CategoryCardProps) {
  const [channelDraft, setChannelDraft] = React.useState(category.channelId ?? '')
  const [open, setOpen] = React.useState(index === 0)
  const enabledCount = category.items.filter((i) => i.enabled).length

  React.useEffect(() => {
    setChannelDraft(category.channelId ?? '')
  }, [category.channelId])

  const dirty = channelDraft !== (category.channelId ?? '')

  // Group items by bossName if any item has one — used for slayer sub-headers.
  const groups = React.useMemo(() => groupItemsByBoss(category.items), [category.items])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.3) }}
    >
      <Card className="overflow-hidden border-border/70">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CardHeader className="gap-2 border-b border-border/60 bg-muted/20 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-md bg-background text-lg ring-1 ring-border">
                  <span aria-hidden="true">{category.emoji}</span>
                </div>
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm sm:text-base">
                    {category.label}
                    {category.channelId ? (
                      <Badge className="gap-1 border-teal-500/30 bg-teal-500/15 text-teal-600 dark:text-teal-400">
                        <Hash className="size-3" aria-hidden="true" />
                        {category.channelId.slice(-6)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        no channel
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="truncate text-xs">
                    {category.description}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 text-[11px]">
                  <Tag className="size-3 text-teal-500" aria-hidden="true" />
                  {enabledCount}/{category.items.length}
                </Badge>
                <CollapsibleTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-7 p-0"
                    aria-label={open ? `Collapse ${category.label}` : `Expand ${category.label}`}
                  >
                    <ChevronDown
                      className={cn('size-4 transition-transform', open && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </CardHeader>

          <CollapsibleContent>
            <CardContent className="space-y-4 p-3 sm:p-4">
              {/* Channel binding + Post Panel */}
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label
                    htmlFor={`channel-${category.id}`}
                    className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    <Hash className="size-3" aria-hidden="true" />
                    Discord Channel ID
                  </label>
                  <Input
                    id={`channel-${category.id}`}
                    value={channelDraft}
                    onChange={(e) => setChannelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && dirty) onChannelSave(channelDraft.trim())
                    }}
                    placeholder="123456789012345678"
                    inputMode="numeric"
                    className="h-8 font-mono text-xs"
                    aria-label={`Discord channel ID for ${category.label}`}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onChannelSave(channelDraft.trim())}
                    disabled={!dirty || !channelDraft.trim()}
                    className="h-8 gap-1.5 border-teal-500/40 bg-teal-500/5 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
                  >
                    <Save className="size-3.5" aria-hidden="true" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    onClick={onPostPanel}
                    disabled={posting || !category.channelId}
                    className="h-8 gap-1.5 bg-gold-500 text-gold-950 hover:bg-gold-600 dark:bg-gold-400 dark:hover:bg-gold-500"
                    aria-label={`Post the carry panel for ${category.label} to its bound Discord channel`}
                  >
                    {posting ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="size-3.5" aria-hidden="true" />
                    )}
                    Post Panel
                  </Button>
                </div>
              </div>

              {!category.channelId && (
                <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  Set a channel ID above to enable <strong>Post Panel</strong>. The panel embed and request buttons
                  are sent to this channel.
                </p>
              )}

              <Separator />

              {/* Items table — grouped by bossName when present */}
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.key} className="space-y-2">
                    {group.label && (
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-sm font-semibold text-foreground">{group.label}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {group.items.length} tier{group.items.length === 1 ? '' : 's'}
                        </Badge>
                        <div className="h-px flex-1 bg-border/60" />
                      </div>
                    )}
                    <ItemsTable
                      items={group.items}
                      onPriceSave={onPriceSave}
                      onToggle={onToggle}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </motion.div>
  )
}

// ── Items table ───────────────────────────────────────────────

interface ItemsTableProps {
  items: CarryItem[]
  onPriceSave: (itemId: string, price: string) => void
  onToggle: (itemId: string, enabled: boolean) => void
}

function ItemsTable({ items, onPriceSave, onToggle }: ItemsTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="h-8 w-[40%] text-[11px] uppercase tracking-wide text-muted-foreground">
              Item
            </TableHead>
            <TableHead className="h-8 w-[16%] text-[11px] uppercase tracking-wide text-muted-foreground">
              Tier
            </TableHead>
            <TableHead className="h-8 w-[28%] text-[11px] uppercase tracking-wide text-muted-foreground">
              Price
            </TableHead>
            <TableHead className="h-8 w-[16%] text-right text-[11px] uppercase tracking-wide text-muted-foreground">
              Enabled
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onPriceSave={onPriceSave}
              onToggle={onToggle}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

interface ItemRowProps {
  item: CarryItem
  onPriceSave: (itemId: string, price: string) => void
  onToggle: (itemId: string, enabled: boolean) => void
}

function ItemRow({ item, onPriceSave, onToggle }: ItemRowProps) {
  const initialPrice = String(item.price ?? '')
  const [draft, setDraft] = React.useState(initialPrice)
  const [saving, setSaving] = React.useState(false)
  const dirty = draft !== initialPrice

  React.useEffect(() => {
    setDraft(String(item.price ?? ''))
  }, [item.price])

  const handleSave = async () => {
    if (!dirty) return
    setSaving(true)
    await onPriceSave(item.id, draft.trim())
    setSaving(false)
  }

  return (
    <TableRow className="group">
      <TableCell className="py-2">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">{item.emoji}</span>
          <span className="text-sm font-medium">{item.label}</span>
          {!item.enabled && (
            <Badge variant="outline" className="ml-1 border-muted-foreground/30 text-[10px] text-muted-foreground">
              hidden
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2">
        {item.tier ? (
          <Badge variant="outline" className="gap-1 text-[11px]">
            {/^\d+$/.test(item.tier) ? 'Tier ' : ''}{item.tier}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-2">
        <div className="flex items-center gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
            placeholder="e.g. 35M"
            className={cn(
              'h-7 w-24 font-mono text-xs',
              dirty && 'border-amber-500/60 bg-amber-500/5',
            )}
            aria-label={`Price for ${item.label}`}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="h-7 gap-1 px-2 text-[11px] text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
          >
            {saving ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-3" aria-hidden="true" />
            )}
            Save
          </Button>
        </div>
      </TableCell>
      <TableCell className="py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="sr-only">
            {item.label} is {item.enabled ? 'enabled' : 'disabled'}
          </span>
          <Switch
            checked={item.enabled}
            onCheckedChange={(v) => onToggle(item.id, v)}
            aria-label={`${item.enabled ? 'Disable' : 'Enable'} ${item.label}`}
          />
          {item.enabled ? (
            <Power className="size-3 text-teal-500" aria-hidden="true" />
          ) : (
            <Power className="size-3 text-muted-foreground/50" aria-hidden="true" />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

// ── Helpers ───────────────────────────────────────────────────

interface ItemGroup {
  key: string
  label: string | null
  items: CarryItem[]
}

/**
 * Group carry items by `bossName` when present. Categories like dungeons / kuudra
 * return a single unlabelled group (no boss sub-header). Slayers return one
 * group per boss (e.g. "Inferno Demonlord") with the tiers inside.
 */
function groupItemsByBoss(items: CarryItem[]): ItemGroup[] {
  const hasBoss = items.some((i) => i.bossName)
  if (!hasBoss) {
    return [{ key: '_default', label: null, items }]
  }
  const order: string[] = []
  const map = new Map<string, CarryItem[]>()
  for (const it of items) {
    const key = it.bossName ?? 'Other'
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(it)
  }
  return order.map((key) => ({
    key,
    label: key,
    items: map.get(key) ?? [],
  }))
}

// ── Empty state ───────────────────────────────────────────────

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description: string
}

function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-muted/10 px-6 py-12 text-center"
    >
      <div className="grid size-12 place-items-center rounded-full bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mx-auto max-w-md text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70">
        <CheckCircle2 className="size-3 text-teal-500" aria-hidden="true" />
        Tip: enable Discord Developer Mode in Settings → Advanced, then right-click your server → Copy ID
      </div>
    </motion.div>
  )
}

// Re-export the castle icon for tests / storybook
export { Castle as CarrySystemIcon }
