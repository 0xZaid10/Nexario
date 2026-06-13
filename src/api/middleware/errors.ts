import type { Request, Response, NextFunction } from 'express'
import { isNexarioError, toHttpStatus } from '../../lib/errors.js'
import { childLogger } from '../../lib/logger.js'
import { env } from '../../config/env.js'

const log = childLogger('middleware:errors')

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (isNexarioError(err)) {
    const status = toHttpStatus(err)
    log.warn({ code: err.code, path: req.path, status }, err.message)

    res.status(status).json({
      error: err.message,
      code: err.code,
      ...(env.NODE_ENV === 'development' && { context: err.context }),
    })
    return
  }

  // Unknown errors
  const message = err instanceof Error ? err.message : 'Internal server error'
  log.error({ err, path: req.path }, message)

  res.status(500).json({
    error: 'Internal server error',
    ...(env.NODE_ENV === 'development' && { detail: message }),
  })
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` })
}
