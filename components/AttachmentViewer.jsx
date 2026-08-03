'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAttachmentSignedUrl, getAttachmentDownloadUrl } from '@/lib/storage'

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const isPdf = (mime, name) =>
  mime === 'application/pdf' || name?.toLowerCase().endsWith('.pdf')

export default function AttachmentViewer({ files, startIndex = 0, onClose }) {
  const [index, setIndex]         = useState(startIndex)
  const [url, setUrl]             = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [downloading, setDownloading] = useState(false)
  const [zoom, setZoom]           = useState(1)

  const file  = files[index]
  const pdf   = file && isPdf(file.mime_type, file.file_name)
  const multi = files.length > 1

  const go = useCallback((delta) => {
    setIndex((i) => {
      const next = i + delta
      if (next < 0 || next >= files.length) return i
      return next
    })
  }, [files.length])

  // Load a fresh signed URL whenever the selected file changes
  useEffect(() => {
    if (!file) return
    let cancelled = false
    setLoading(true)
    setError('')
    setUrl(null)
    setZoom(1)
    getAttachmentSignedUrl(file.file_path)
      .then((u) => { if (!cancelled) { setUrl(u); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Could not load this file.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [file?.id])

  // Keyboard: Esc closes, arrows navigate
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')  go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, go])

  async function handleDownload() {
    if (!file) return
    setDownloading(true)
    try {
      const dl = await getAttachmentDownloadUrl(file.file_path, file.file_name)
      const a = document.createElement('a')
      a.href = dl
      a.download = file.file_name || ''
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setError('Download failed. Try again.')
    } finally {
      setDownloading(false)
    }
  }

  if (!file) return null

  const btn = 'p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-40'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl w-full max-w-5xl h-[92vh] z-10 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
            pdf ? 'bg-red-50 border-red-200' : 'bg-indigo-50 border-indigo-200'
          }`}>
            <svg className={`w-4 h-4 ${pdf ? 'text-red-600' : 'text-indigo-600'}`} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              {pdf
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
                : <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Z"/>}
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate" title={file.file_name}>{file.file_name}</p>
            <p className="text-[11px] text-slate-400">
              {formatSize(file.file_size)}
              {multi && <span> · {index + 1} of {files.length}</span>}
            </p>
          </div>

          {/* Image zoom controls */}
          {!pdf && !loading && !error && (
            <div className="flex items-center gap-0.5 mr-1">
              <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} disabled={zoom <= 0.25} title="Zoom out" className={btn}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
                </svg>
              </button>
              <span className="text-[11px] text-slate-500 tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} disabled={zoom >= 4} title="Zoom in" className={btn}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
                </svg>
              </button>
            </div>
          )}

          <button onClick={handleDownload} disabled={downloading} title="Download" className={btn}>
            {downloading ? (
              <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-500 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
              </svg>
            )}
          </button>

          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab" className={btn}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
              </svg>
            </a>
          )}

          <div className="w-px h-5 bg-slate-200 mx-1" />

          <button onClick={onClose} title="Close" className={btn}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 relative bg-slate-100 overflow-auto">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2.5">
              <div className="w-5 h-5 border-2 border-violet-400/40 border-t-violet-500 rounded-full animate-spin" />
              <span className="text-sm text-slate-500">Loading…</span>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/>
                </svg>
              </div>
              <p className="text-sm text-slate-600">{error}</p>
            </div>
          )}

          {!loading && !error && url && (
            pdf ? (
              <iframe
                key={file.id}
                src={`${url}#toolbar=1&navpanes=0&view=FitH`}
                title={file.file_name}
                className="w-full h-full border-0 bg-white"
              />
            ) : (
              <div className="min-h-full flex items-center justify-center p-6">
                <img
                  src={url}
                  alt={file.file_name}
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-lg transition-transform duration-150"
                />
              </div>
            )
          )}

          {/* Prev / Next */}
          {multi && (
            <>
              <button
                onClick={() => go(-1)}
                disabled={index === 0}
                title="Previous"
                className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/90 border border-slate-200 shadow-lg text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-0 disabled:pointer-events-none transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/>
                </svg>
              </button>
              <button
                onClick={() => go(1)}
                disabled={index === files.length - 1}
                title="Next"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/90 border border-slate-200 shadow-lg text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-0 disabled:pointer-events-none transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
