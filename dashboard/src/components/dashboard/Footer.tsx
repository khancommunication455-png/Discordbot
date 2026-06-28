'use client'

import * as React from 'react'
import { Github, Heart } from 'lucide-react'
import { motion } from 'framer-motion'

export function Footer() {
  // Start as null so SSR and the first client render both produce the same
  // markup (no timestamp). The actual time is only rendered after mount,
  // which avoids hydration mismatches caused by:
  //   1. Time elapsing between server render and client hydrate
  //   2. Server timezone (UTC) vs client timezone (user's locale)
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const timeStr = now
    ? new Date(now).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'

  return (
    <footer
      role="contentinfo"
      className="mt-auto border-t border-border/60 bg-card/40 backdrop-blur supports-[backdrop-filter]:bg-card/30"
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:gap-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-wrap items-center justify-center gap-2 text-center sm:justify-start"
        >
          <span className="font-semibold text-foreground">SkyBot v2</span>
          <span className="text-muted-foreground/40" aria-hidden="true">
            •
          </span>
          <span>Railway Edition</span>
          <span className="text-muted-foreground/40" aria-hidden="true">
            •
          </span>
          <span className="inline-flex items-center gap-1">
            Built for Hypixel Skyblock communities
            <Heart className="size-3 fill-gold-500 text-gold-500" aria-hidden="true" />
          </span>
        </motion.div>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com/skybot/v2"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-label="View SkyBot source on GitHub"
          >
            <Github className="size-3.5" aria-hidden="true" />
            <span>GitHub</span>
          </a>
          <span className="text-muted-foreground/40" aria-hidden="true">
            •
          </span>
          {/* Suppress hydration warning on the time element — the server
              renders "—" and the client replaces it after mount. */}
          <time
            className="tabular-nums font-medium text-foreground/80"
            dateTime={now ? new Date(now).toISOString() : undefined}
            aria-label={`Current time ${timeStr}`}
            suppressHydrationWarning
          >
            {timeStr}
          </time>
        </div>
      </div>
    </footer>
  )
}
