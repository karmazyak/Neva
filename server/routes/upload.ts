import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const upload = new Hono()
upload.use('*', authMiddleware)

const UPLOAD_DIR = './data/uploads'
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50MB

const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv']
const allowedExts = [...imageExts, ...videoExts, 'pdf', 'doc', 'docx', 'txt', 'mp3', 'ogg', 'wav', 'm4a', 'aac', 'mp4', 'weba']

// Ensure upload dir exists
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true })
}

const audioExts = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'weba']

function getFileType(ext: string, filename?: string): 'image' | 'video' | 'file' {
  const lower = ext.toLowerCase()
  if (imageExts.includes(lower)) return 'image'
  // Voice recordings named voice_xxx should be treated as files, not video
  if (filename?.startsWith('voice_') && (lower === 'mp4' || lower === 'webm')) return 'file'
  if (audioExts.includes(lower)) return 'file'
  if (videoExts.includes(lower)) return 'video'
  return 'file'
}

async function processUpload(file: File) {
  const ext = file.name?.split('.').pop() || 'bin'
  const lower = ext.toLowerCase()

  if (!allowedExts.includes(lower)) {
    return { error: `File type .${ext} not allowed` }
  }

  const fileType = getFileType(lower, file.name)
  const maxSize = fileType === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE

  if (file.size > maxSize) {
    const maxMB = maxSize / (1024 * 1024)
    return { error: `File too large (max ${maxMB}MB for ${fileType})` }
  }

  const filename = `${crypto.randomUUID()}.${lower}`
  const filepath = join(UPLOAD_DIR, filename)

  const buffer = await file.arrayBuffer()
  await Bun.write(filepath, buffer)

  return {
    url: `/uploads/${filename}`,
    type: fileType,
    filename: file.name,
    size: file.size,
  }
}

// Upload single file
upload.post('/', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No file provided' }, 400)
  }

  const result = await processUpload(file as File)
  if ('error' in result) {
    const status = result.error.includes('too large') ? 413 : 400
    return c.json({ error: result.error }, status)
  }

  return c.json(result)
})

// Batch upload (up to 10 files)
upload.post('/batch', async (c) => {
  const body = await c.req.parseBody({ all: true })
  const files = body['files']

  if (!files) {
    return c.json({ error: 'No files provided' }, 400)
  }

  const fileArray = Array.isArray(files) ? files : [files]
  const validFiles = fileArray.filter((f): f is File => typeof f !== 'string')

  if (validFiles.length === 0) {
    return c.json({ error: 'No valid files provided' }, 400)
  }

  if (validFiles.length > 10) {
    return c.json({ error: 'Maximum 10 files per upload' }, 400)
  }

  const results = await Promise.all(validFiles.map(processUpload))

  const errors = results.filter((r) => 'error' in r)
  if (errors.length === results.length) {
    return c.json({ error: 'All files failed', details: errors }, 400)
  }

  return c.json({
    files: results.filter((r) => !('error' in r)),
    errors: errors.length > 0 ? errors : undefined,
  })
})

export default upload
