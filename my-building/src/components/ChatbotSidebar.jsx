import { useMemo, useState } from 'react'
import { buildApiUrl, CHAT_API_BASE, CHAT_API_PATH } from '../config/api.js'

export default function ChatbotSidebar() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello. Ask me about the GATE building data.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const endpoint = useMemo(() => buildApiUrl(CHAT_API_BASE, CHAT_API_PATH), [])

  const sendMessage = async (event) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const nextHistory = [...messages, { role: 'user', content: text }]
    setMessages(nextHistory)
    setInput('')
    setLoading(true)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: nextHistory
        })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const detail = data?.detail || data?.error || `HTTP ${response.status}`
        throw new Error(String(detail))
      }

      const reply = data?.reply ?? data?.response ?? data?.message

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply ? String(reply) : 'No supported response field returned by server.'
        }
      ])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Connection error: ${error.message}`
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside className="chatbot-sidebar">
      <div className="chatbot-header">Chatbot</div>

      <div className="chatbot-messages">
        {messages.map((message, index) => (
          <div key={index} className={`chatbot-msg ${message.role}`}>
            <strong>{message.role === 'user' ? 'You' : 'Facility Manager'}:</strong> {message.content}
          </div>
        ))}
        {loading && <div className="chatbot-msg assistant">Facility Manager is typing...</div>}
      </div>

      <form className="chatbot-input-row" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type your message..."
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  )
}
