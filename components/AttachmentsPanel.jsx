'use client'

import { useState, useEffect, useRef } from 'react'
import { getAttachments, uploadAttachment, deleteAttachment, getAttachmentSignedUrl } from '@/lib/storage'

const ACCEPT = '.pdf,.jpg,.jpeg,.png'
const MAX_MB  = 10
const MAX_SIZE = MAX_MB * 1024 * 1024
const VALID_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function FileTypeIcon({ mime }) {
  if (mime === 'application/pdf') {
    return (
      <div className="w-8 h-8 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
        </svg>
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
      <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/>
      </svg>
    </div>
  )
}

export default function AttachmentsPanel({ entryId, entryDescription, onClose, uploaderEmail, onCountChange }) {
  const [files, setFiles]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [openingId, setOpeningId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // the attachment object pending delete
  const [error, setError]         = useState('')
  const [dragging, setDragging]   = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!entryId) return
    getAttachments(entryId)
      .then(setFiles)
      .catch(() => setError('Failed to load attachments.'))
      .finally(() => setLoading(false))
  }, [entryId])

  async function processFiles(fileList) {
    const list = Array.from(fileList)
    setError('')
    for (const f of list) {
      if (f.size > MAX_SIZE) { setError(`"${f.name}" exceeds ${MAX_MB} MB limit.`); return }
      const ext = f.name.split('.').pop()?.toLowerCase()
      if (!VALID_TYPES.includes(f.type) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
        setError(`"${f.name}" is not a supported file type. Use PDF, JPEG, or PNG.`)
        return
      }
    }
    setUploading(true)
    const added = []
    try {
      for (const f of list) {
        const uploaded = await uploadAttachment(entryId, f, uploaderEmail)
        added.push(uploaded)
        setFiles((prev) => [...prev, uploaded])
      }
      onCountChange?.(entryId, files.length + added.length)
    } catch {
      setError('Upload failed. Check your connection and try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleOpen(att) {
    setOpeningId(att.id)
    try {
      const url = await getAttachmentSignedUrl(att.file_path)
      window.open(url, '_blank', 'noopener')
    } catch {
      setError('Could not open file. Try again.')
    } finally {
      setOpeningId(null)
    }
  }

  async function confirmDeleteFile() {
    if (!confirmDelete) return
    const att = confirmDelete
    setConfirmDelete(null)
    setDeletingId(att.id)
    try {
      await deleteAttachment(att.id, att.file_path)
      const next = files.filter((f) => f.id !== att.id)
      setFiles(next)
      onCountChange?.(entryId, next.length)
    } catch {
      setError('Delete failed. Check your connection.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl shadow-indigo-100/40 w-full max-w-md z-10 max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center">
                <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"/>
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 leading-tight">Attachments</h2>
                {files.length > 0 && <p className="text-[11px] text-slate-400">{files.length} file{files.length !== 1 ? 's' : ''}</p>}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          {entryDescription && (
            <p className="text-[11px] text-slate-400 mt-2 truncate leading-relaxed" title={entryDescription}>{entryDescription}</p>
          )}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2">
              <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-500 rounded-full animate-spin" />
              <span className="text-xs text-slate-400">Loading…</span>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-10 px-6">
              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"/>
                </svg>
              </div>
              <p className="text-sm text-slate-500 font-medium">No attachments</p>
              <p className="text-xs text-slate-400 mt-1">Upload a PDF, JPEG, or PNG below</p>
            </div>
          ) : (
            <div className="p-3 space-y-1.5">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50/30 transition-all group/file"
                >
                  <FileTypeIcon mime={f.mime_type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">{f.file_name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {formatSize(f.file_size)}{f.file_size && f.created_at ? ' · ' : ''}{formatDate(f.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover/file:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => handleOpen(f)}
                      disabled={openingId === f.id}
                      title="Open"
                      className="p-1.5 rounded-lg hover:bg-indigo-100 text-slate-400 hover:text-indigo-600 disabled:opacity-40 transition-colors"
                    >
                      {openingId === f.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-indigo-400/40 border-t-indigo-500 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(f)}
                      disabled={deletingId === f.id}
                      title="Delete"
                      className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                    >
                      {deletingId === f.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-red-400/40 border-t-red-500 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inline delete confirmation */}
        {confirmDelete && (
          <div className="absolute inset-0 z-20 flex items-end justify-center rounded-2xl overflow-hidden">
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
            <div className="relative w-full bg-white border-t border-slate-200 px-5 py-5 z-10">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-red-100 border border-red-200 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Delete this file?</p>
                  <p className="text-xs text-slate-500 mt-0.5 break-all">{confirmDelete.file_name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">This cannot be undone.</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteFile}
                  className="px-4 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-all"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload zone */}
        <div className="px-4 pb-4 pt-3 border-t border-slate-100">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
              {error}
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => { processFiles(e.target.files); e.target.value = '' }}
          />
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files) }}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all select-none ${
              dragging
                ? 'border-violet-400 bg-violet-50'
                : uploading
                  ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
                  : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/40'
            }`}
          >
            {uploading ? (
              <div className="flex items-center gap-2.5">
                <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-500 rounded-full animate-spin" />
                <span className="text-xs text-slate-500">Uploading…</span>
              </div>
            ) : (
              <>
                <svg className="w-6 h-6 text-slate-400 mb-2" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/>
                </svg>
                <p className="text-xs text-slate-500">Drop files here or <span className="text-violet-600 font-medium">browse</span></p>
                <p className="text-[11px] text-slate-400 mt-1">PDF, JPEG, PNG · Max {MAX_MB} MB per file</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
