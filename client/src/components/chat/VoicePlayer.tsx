import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, Type } from 'lucide-react'
import { api } from '../../lib/api'

interface VoicePlayerProps {
  src: string
  messageId?: string
  duration?: number
  isOwn?: boolean
  existingTranscription?: string
}

const BAR_COUNT = 32
const SPEEDS = [1, 1.5, 2]

export default function VoicePlayer({ src, messageId, duration: metaDuration, isOwn, existingTranscription }: VoicePlayerProps) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(metaDuration || 0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const [waveform, setWaveform] = useState<number[]>([])
  const [transcription, setTranscription] = useState(existingTranscription || '')
  const [transcribing, setTranscribing] = useState(false)
  const [showTranscription, setShowTranscription] = useState(!!existingTranscription)
  const audioRef = useRef<HTMLAudioElement>(null)
  const animFrameRef = useRef<number>()

  // Generate waveform from audio data
  useEffect(() => {
    generateWaveform()
  }, [src])

  const generateWaveform = useCallback(async () => {
    try {
      const ctx = new AudioContext()
      const response = await fetch(src)
      const buffer = await response.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(buffer)
      const data = audioBuffer.getChannelData(0)

      const bars: number[] = []
      const samplesPerBar = Math.floor(data.length / BAR_COUNT)

      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0
        const start = i * samplesPerBar
        for (let j = start; j < start + samplesPerBar && j < data.length; j++) {
          sum += Math.abs(data[j])
        }
        bars.push(sum / samplesPerBar)
      }

      // Normalize to 0-1
      const max = Math.max(...bars, 0.01)
      setWaveform(bars.map(b => Math.max(0.08, b / max)))

      // Set duration from audio buffer
      if (!metaDuration) setDuration(audioBuffer.duration)

      ctx.close()
    } catch {
      // Fallback: random-ish waveform
      const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
        const x = i / BAR_COUNT
        return 0.15 + 0.7 * Math.abs(Math.sin(x * 4 + 1) * Math.cos(x * 7 + 2))
      })
      setWaveform(bars)
    }
  }, [src, metaDuration])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onMeta = () => { if (!metaDuration) setDuration(audio.duration || 0) }
    const onEnd = () => { setPlaying(false); setProgress(0); cancelAnimationFrame(animFrameRef.current!) }

    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnd)
      cancelAnimationFrame(animFrameRef.current!)
    }
  }, [metaDuration])

  // Smooth progress update via requestAnimationFrame
  const updateProgress = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.duration && playing) {
      setProgress(audio.currentTime / audio.duration)
      animFrameRef.current = requestAnimationFrame(updateProgress)
    }
  }, [playing])

  useEffect(() => {
    if (playing) {
      animFrameRef.current = requestAnimationFrame(updateProgress)
    } else {
      cancelAnimationFrame(animFrameRef.current!)
    }
    return () => cancelAnimationFrame(animFrameRef.current!)
  }, [playing, updateProgress])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause() } else { audio.play() }
    setPlaying(!playing)
  }

  const cycleSpeed = () => {
    const next = (speedIndex + 1) % SPEEDS.length
    setSpeedIndex(next)
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]
  }

  const seekFromBar = (barIndex: number) => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    const pct = barIndex / BAR_COUNT
    audio.currentTime = pct * audio.duration
    setProgress(pct)
  }

  const handleTranscribe = async () => {
    if (!messageId || transcribing) return
    if (transcription) {
      setShowTranscription(!showTranscription)
      return
    }
    setTranscribing(true)
    setShowTranscription(true)
    try {
      const res = await api.transcribeMessage(messageId)
      setTranscription(res.transcription)
    } catch {
      setTranscription('Transcription unavailable')
    }
    setTranscribing(false)
  }

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const currentTime = audioRef.current?.currentTime || 0
  const displayTime = playing ? fmt(currentTime) : fmt(duration)
  const activeBar = Math.floor(progress * BAR_COUNT)

  return (
    <div className="min-w-[220px] max-w-[300px]">
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="flex items-center gap-2.5">
        {/* Play/Pause button */}
        <button
          onClick={toggle}
          className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0 hover:bg-accent-hover transition-colors shadow-sm"
        >
          {playing
            ? <Pause size={17} className="text-white" />
            : <Play size={17} className="text-white ml-0.5" />
          }
        </button>

        <div className="flex-1 flex flex-col gap-1">
          {/* Waveform bars */}
          <div className="flex items-end gap-[2px] h-[28px] cursor-pointer" onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pct = (e.clientX - rect.left) / rect.width
            const bar = Math.floor(pct * BAR_COUNT)
            seekFromBar(bar)
          }}>
            {waveform.length > 0 ? waveform.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors duration-75"
                style={{
                  height: `${Math.max(3, h * 28)}px`,
                  backgroundColor: i <= activeBar
                    ? (isOwn ? 'rgba(255,255,255,0.9)' : 'rgb(44,196,196)')
                    : (isOwn ? 'rgba(255,255,255,0.3)' : 'rgba(44,196,196,0.3)'),
                  minWidth: '2px',
                }}
              />
            )) : (
              // Loading placeholder
              Array.from({ length: BAR_COUNT }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full animate-pulse"
                  style={{
                    height: `${4 + Math.random() * 16}px`,
                    backgroundColor: isOwn ? 'rgba(255,255,255,0.2)' : 'rgba(44,196,196,0.2)',
                    minWidth: '2px',
                  }}
                />
              ))
            )}
          </div>

          {/* Time + Speed */}
          <div className="flex items-center justify-between">
            <span className={`text-[10px] ${isOwn ? 'text-white/60' : 'text-text-secondary'}`}>
              {displayTime}
            </span>
            <div className="flex items-center gap-1.5">
              {/* Speed toggle */}
              <button
                onClick={cycleSpeed}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  isOwn ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-text-secondary hover:text-accent hover:bg-accent/10'
                } transition-colors`}
              >
                {SPEEDS[speedIndex]}x
              </button>
              {/* Transcribe button */}
              {messageId && (
                <button
                  onClick={handleTranscribe}
                  className={`p-0.5 rounded transition-colors ${
                    showTranscription
                      ? (isOwn ? 'text-white bg-white/15' : 'text-accent bg-accent/15')
                      : (isOwn ? 'text-white/50 hover:text-white' : 'text-text-secondary hover:text-accent')
                  }`}
                  title="Transcribe"
                >
                  <Type size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Transcription text */}
      {showTranscription && (
        <div className={`mt-1.5 text-xs leading-relaxed rounded-lg px-2 py-1.5 ${
          isOwn ? 'bg-white/10 text-white/80' : 'bg-accent/5 text-text-secondary'
        }`}>
          {transcribing ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Transcribing...
            </span>
          ) : (
            transcription
          )}
        </div>
      )}
    </div>
  )
}
