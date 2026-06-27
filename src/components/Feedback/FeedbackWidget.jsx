import { useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus, X, Send, CheckCircle2, AlertCircle } from 'lucide-react'

// Free, no-backend delivery via FormSubmit.co. 
// NOTE: To prevent your email from being visible in the client-side code, 
// replace this with a FormSubmit Random String (get one by visiting formsubmit.co/your-email)
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'roshankavil009@gmail.com'
const FORMSUBMIT_ENDPOINT = `https://formsubmit.co/ajax/${CONTACT_EMAIL}`
const SUBJECT = 'HSI Studio — Feature request / feedback'

/**
 * FeedbackWidget — a "Need a feature / write to us" button + modal.
 *
 * Self-contained: renders its own trigger button and a portal modal. Users can
 * type a message that is delivered via FormSubmit, or email directly (mailto).
 *
 * Props:
 *  - className / style: applied to the trigger button (defaults to a toolbar button)
 *  - label: button text
 */
export default function FeedbackWidget({
  className = 'toolbar-btn toolbar-btn-text',
  style,
  label = 'Feedback',
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | success | error
  const [errorMsg, setErrorMsg] = useState('')

  const close = () => {
    setOpen(false)
    // Reset after the modal is gone
    setTimeout(() => {
      setMessage('')
      setEmail('')
      setStatus('idle')
      setErrorMsg('')
    }, 200)
  }


  const submit = async (e) => {
    e.preventDefault()
    if (!message.trim() || status === 'sending') return
    setStatus('sending')
    setErrorMsg('')
    try {
      const res = await fetch(FORMSUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          'reply-to': email.trim() || 'not provided',
          _subject: SUBJECT,
          _template: 'table',
          _captcha: 'false',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && (data.success === true || data.success === 'true')) {
        setStatus('success')
      } else {
        throw new Error(data.message || `Request failed (${res.status})`)
      }
    } catch (err) {
      setErrorMsg(err.message || 'Network error')
      setStatus('error')
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        onClick={() => setOpen(true)}
        title="Request a feature / write to us"
      >
        <MessageSquarePlus size={16} /> {label}
      </button>

      {open && createPortal(
        <div
          onClick={close}
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-xl)',
            animation: 'fadeIn var(--transition-normal) forwards',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-secondary)',
              border: 'var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              width: '100%', maxWidth: 460,
              boxShadow: 'var(--glass-shadow)',
              display: 'flex', flexDirection: 'column',
              fontFamily: 'var(--font-sans)',
              color: 'var(--text-primary)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-lg)', borderBottom: 'var(--border-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 'var(--radius-md)',
                  background: 'var(--gradient-subtle)', border: 'var(--border-accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent-blue)', flexShrink: 0,
                }}>
                  <MessageSquarePlus size={18} />
                </div>
                <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                  Request a feature
                </h2>
              </div>
              <button
                onClick={close}
                aria-label="Close"
                style={{
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', padding: 6, borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: 'var(--space-lg)' }}>
              {status === 'success' ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  textAlign: 'center', gap: 'var(--space-md)', padding: 'var(--space-lg) 0',
                }}>
                  <CheckCircle2 size={40} style={{ color: 'var(--accent-teal)' }} />
                  <div style={{ fontSize: 'var(--font-md)', fontWeight: 600 }}>Thanks for the feedback!</div>
                  <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-tertiary)' }}>
                    Your message is on its way. We read every one.
                  </div>
                  <button
                    onClick={close}
                    style={{
                      marginTop: 'var(--space-sm)',
                      background: 'var(--gradient-primary)', color: '#fff', border: 'none',
                      borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-xl)',
                      fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>
                    Found a bug or want a feature? Tell us what would make HSI Studio better.
                  </p>

                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
                      Message
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="I'd love to be able to…"
                      rows={5}
                      autoFocus
                      style={{
                        width: '100%', resize: 'vertical',
                        background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                        border: 'var(--border-default)', borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-sm) var(--space-md)', fontSize: 'var(--font-sm)',
                        fontFamily: 'var(--font-sans)', lineHeight: 1.5, outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
                      Your email <span style={{ color: 'var(--text-tertiary)' }}>(optional, so we can reply)</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      style={{
                        width: '100%',
                        background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                        border: 'var(--border-default)', borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-sm) var(--space-md)', fontSize: 'var(--font-sm)',
                        fontFamily: 'var(--font-sans)', outline: 'none',
                      }}
                    />
                  </div>

                  {status === 'error' && (
                    <div style={{
                      display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start',
                      background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)',
                      borderRadius: 'var(--radius-sm)', padding: 'var(--space-sm) var(--space-md)',
                      fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', lineHeight: 1.5,
                    }}>
                      <AlertCircle size={14} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 1 }} />
                      <span>Couldn't send ({errorMsg}). Please try again later.</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!message.trim() || status === 'sending'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-sm)',
                      background: !message.trim() || status === 'sending' ? 'var(--bg-tertiary)' : 'var(--gradient-primary)',
                      color: !message.trim() || status === 'sending' ? 'var(--text-secondary)' : '#fff',
                      border: 'none', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)',
                      fontSize: 'var(--font-sm)', fontWeight: 600,
                      cursor: !message.trim() || status === 'sending' ? 'not-allowed' : 'pointer',
                      boxShadow: !message.trim() || status === 'sending' ? 'none' : '0 2px 12px var(--accent-blue-glow)',
                    }}
                  >
                    {status === 'sending'
                      ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Sending…</>
                      : <><Send size={16} /> Send</>}
                  </button>


                </form>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
