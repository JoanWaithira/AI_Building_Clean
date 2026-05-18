import { useState, useEffect, useRef, useCallback } from "react";

import ChatbotIcon from "./ChatbotIcon";
import ChatForm from "./ChatForm";
import ChatMessage from "./ChatMessage";
import { buildApiUrl, CHAT_API_BASE, CHAT_API_PATH } from "../config/api.js";

const HINTS = [
  "Hi there! I'm your AI facility manager.",
  "Looking for something specific?",
  "Did you know I use agentic AI?",
  "Ask me anything about the building!",
  "Chat with your AI facility manager",
  "Need help? I'm here!",
  "Try: \"Show me room 1.02\"",
  "I can control the 3D viewer too!",
  "Ask me to zoom to a floor or room!",
  "Don't know where to go? Just ask!",
];

function HintBubble({ visible, btnPos }) {
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (!visible) return;
    // Show hint for 2s, then hide; repeat every 15s
    setShow(true);
    const hideTimeout = setTimeout(() => setShow(false), 2000);
    const interval = setInterval(() => {
      setIdx(i => (i + 1) % HINTS.length);
      setShow(true);
      setTimeout(() => setShow(false), 5000);
    }, 4500);

    return () => { clearTimeout(hideTimeout); clearInterval(interval); };
  }, [visible]);



  if (!visible) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: window.innerHeight - btnPos.y + 5,
      right: window.innerWidth - btnPos.x + 10,
      zIndex: 1200,
      background: "#6D4FC2", color: "#fff", fontSize: 12, fontWeight: 500,
      padding: "8px 14px", borderRadius: "12px 12px 4px 12px",
      boxShadow: "0 4px 16px rgba(109,79,194,0.35)",
      opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(6px)",
      transition: "opacity 0.35s, transform 0.35s",
      pointerEvents: "none", whiteSpace: "nowrap", maxWidth: 220,
    }}>
      {HINTS[idx]}
    </div>
  );
}

const FacilityChatbot = () => {
  const [chatHistory, setChatHistory] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const chatBodyRef = useRef(null);

  // Draggable button state — initial position: bottom-right corner
  const [btnPos, setBtnPos] = useState({ x: window.innerWidth - 40, y: window.innerHeight - 40 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  // Keep button in bounds on window resize
  useEffect(() => {
    const onResize = () => {
      setBtnPos(prev => ({
        x: Math.min(prev.x, window.innerWidth - 20),
        y: Math.min(prev.y, window.innerHeight - 20),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e) => {
    dragging.current = true;
    hasMoved.current = false;
    dragOffset.current = { x: e.clientX - btnPos.x, y: e.clientY - btnPos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [btnPos]);

  const onPointerMove = useCallback((e) => {
    if (!dragging.current) return;
    hasMoved.current = true;
    const x = Math.max(25, Math.min(window.innerWidth - 25, e.clientX - dragOffset.current.x));
    const y = Math.max(25, Math.min(window.innerHeight - 25, e.clientY - dragOffset.current.y));
    setBtnPos({ x, y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const dispatchCesiumCommand = (command) => {
    if (!command) return;

    const viewerReady = Boolean(window.__cesiumViewerReady);
    if (!viewerReady) {
      const pending = Array.isArray(window.__pendingCesiumCommands)
        ? window.__pendingCesiumCommands
        : [];
      pending.push(command);
      window.__pendingCesiumCommands = pending;
      return;
    }

    window.dispatchEvent(
      new CustomEvent("cesium-command", {
        detail: command,
      })
    );
  };

  const parseNavigationCommand = (message) => {
    const normalized = String(message || "").trim();
    const highlightMatch = normalized.match(
      /^(?:highlight|mark)\s+(.+)$/i
    );
    const match = normalized.match(
      /^(?:zoom\s+(?:to|into|in\s+to)|show\s+(?:me\s+)?|focus\s+on|go\s+to|fly\s+to|take\s+me\s+to)\s+(.+)$/i
    );
    const isHighlight = Boolean(highlightMatch);
    const commandMatch = highlightMatch || match;
    if (!commandMatch) return null;

    const rawTarget = String(commandMatch[1] || "").trim();
    const target = rawTarget
      .replace(/^["'`\s]+|["'`\s]+$/g, "")
      .replace(/[!?.,;:]+$/g, "")
      .replace(/\bin\s+(?:the\s+)?visuali[sz]ation\b.*$/i, "")
      .replace(/\b(?:in|on)\s+(?:the\s+)?viewer\b.*$/i, "")
      .replace(/\b(?:'s)?\s+room\b/i, "")
      .replace(/^the\s+/i, "")
      .trim();
    if (!target) return null;

    const lowered = target.toLowerCase();
    const compact = lowered.replace(/\s+/g, "");

    let normalizedTarget = target;
    if (/(^|\b)(elevators?|lifts?)(\b|$)/i.test(target)) {
      normalizedTarget = "elevator";
    }

    const looksLikeCircuit =
      /\bcircuit\b/.test(lowered) ||
      /^(?:circuit)?\d+$/.test(compact) ||
      /(main|elevator|boiler|air\s*conditioner|outside\s*lighting|vehicle\s*charging|3d\s*led|x3dled|ovk)/.test(
        lowered
      );

    if (looksLikeCircuit) {
      return {
        action: isHighlight ? "zoom_to_circuit" : "zoom_to_circuit",
        replyText: `${isHighlight ? "Highlighting" : "Zooming to"} ${target}.`,
        payload: {
          type: "cesium",
          action: "zoom_to_circuit",
          circuit_id: normalizedTarget,
        },
      };
    }

    // Detect floor pattern: "floor 2", "2nd floor", "floor -1", etc.
    const floorMatch =
      lowered.match(/^floor\s+(-?\d+)$/) ||
      lowered.match(/^(-?\d+)(?:st|nd|rd|th)?\s+floor$/) ||
      lowered.match(/^floor(-?\d+)$/);
    if (floorMatch) {
      const floorNumber = floorMatch[1];
      return {
        action: "zoom_to_floor",
        replyText: `Zooming to floor ${floorNumber}.`,
        payload: {
          type: "cesium",
          action: "zoom_to_floor",
          floor: floorNumber,
        },
      };
    }

    // Detect room number pattern: "room 0.02", "room 2.12", "0.02", "2.12", etc.
    const roomNumberMatch =
      lowered.match(/^room\s+(-?\d+\.\d+)$/) ||
      lowered.match(/^(-?\d+\.\d+)$/);
    if (roomNumberMatch) {
      const roomNumber = roomNumberMatch[1];
      return {
        action: "zoom_to_room",
        replyText: `${isHighlight ? "Highlighting" : "Zooming to"} room ${roomNumber}.`,
        payload: {
          type: "cesium",
          action: "zoom_to_room",
          room_number: roomNumber,
        },
      };
    }

    if (isHighlight) {
      return {
        action: "highlight_by_name",
        replyText: `Highlighting ${target}.`,
        payload: {
          type: "cesium",
          action: "highlight_by_name",
          name: normalizedTarget,
        },
      };
    }

    return {
      action: "zoom_to_name",
      replyText: `Zooming to ${target}.`,
      payload: {
        type: "cesium",
        action: "zoom_to_name",
        name: normalizedTarget,
      },
    };
  };

  const generateBotResponse = async (history, latestMessage) => {
  try {
    const normalizedHistory = (history || [])
      .filter((msg) => msg?.sender === "user" || msg?.sender === "bot")
      .map((msg) => ({
        role: msg.sender === "bot" ? "assistant" : "user",
        content: String(msg.text || "").trim(),
      }))
      .filter((msg) => msg.content);

    const last = normalizedHistory[normalizedHistory.length - 1];
    const message = (latestMessage || last?.content || "").trim();
    if (!message) {
      throw new Error("Empty message");
    }

    const parsedZoom = parseNavigationCommand(message);
    let localCommand = null;
    if (parsedZoom) {
      localCommand = parsedZoom.payload;
      dispatchCesiumCommand(localCommand);
    }

    

    const response = await fetch(buildApiUrl(CHAT_API_BASE, CHAT_API_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: normalizedHistory,
        clientCommand: localCommand,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (data?.cesiumCommand) {
      const serverCmd = data.cesiumCommand;
      const serverKey = serverCmd.circuit_id || serverCmd.name || serverCmd.room_query || serverCmd.room_number || String(serverCmd.floor ?? "") || "";
      const localKey = localCommand ? (localCommand.circuit_id || localCommand.name || localCommand.room_number || String(localCommand.floor ?? "") || "") : null;
      const sameAsLocal =
        localCommand &&
        serverCmd.type === localCommand.type &&
        serverCmd.action === localCommand.action &&
        serverKey === localKey;

      if (!sameAsLocal) {
        dispatchCesiumCommand(data.cesiumCommand);
      }
    }

    if (!response.ok) {
      const detail = data?.detail || data?.error || `HTTP ${response.status}`;
      throw new Error(String(detail));
    }

    const apiResponseText =
      data?.reply?.replace(/\*\*(.*?)\*\*/g, "$1")?.trim() ||
      "No response text returned.";

    setChatHistory((prev) => [
      ...prev.filter((msg) => msg.text !== "Facility Manager is typing..."),
      { sender: "bot", text: apiResponseText },
    ]);
  } catch (error) {
    console.error(error);
    setChatHistory((prev) => [
      ...prev.filter((msg) => msg.text !== "Facility Manager is typing..."),
      { sender: "bot", text: `Connection error: ${error.message}` },
    ]);
  }
};

  useEffect(() => {
    const handleScenarioPrompt = (event) => {
      const prompt = String(event?.detail?.prompt || "").trim();
      if (!prompt) return;

      setIsOpen(true);
      setChatHistory((prev) => {
        const next = [
          ...prev,
          { sender: "user", text: prompt },
          { sender: "bot", text: "Facility Manager is typing..." },
        ];

        queueMicrotask(() => {
          generateBotResponse(next, prompt);
        });

        return next;
      });
    };

    window.addEventListener("scenario-chat-prompt", handleScenarioPrompt);
    return () => window.removeEventListener("scenario-chat-prompt", handleScenarioPrompt);
  }, []);

  useEffect(() => {
    if (!chatBodyRef.current) return;
    chatBodyRef.current.scrollTo({
      top: chatBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatHistory, isOpen]);

  return (
    <div className={`container ${isOpen ? "show-chatbot" : ""}`}>
      <HintBubble visible={!isOpen} btnPos={btnPos} />
      <button
        id="chatbot-toggler"
        type="button"
        onClick={() => { if (!hasMoved.current) setIsOpen((v) => !v); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label={isOpen ? "Close chatbot" : "Open chatbot"}
        aria-expanded={isOpen}
        style={{
          position: "fixed",
          left: btnPos.x - 25,
          top: btnPos.y - 25,
          bottom: "auto",
          right: "auto",
          touchAction: "none",
          cursor: dragging.current ? "grabbing" : "grab",
        }}
      >
        <span className="material-symbols-rounded icon-open">mode_comment</span>
        <span className="material-symbols-rounded icon-close">close</span>
      </button>

     
      <div className="chat-popup" role="dialog" aria-hidden={!isOpen} style={{
        position: "fixed",
        left: Math.max(8, Math.min(btnPos.x - 310, window.innerWidth - 348)),
        top: Math.max(8, Math.min(btnPos.y - 470, window.innerHeight - 440)),
        bottom: "auto",
        right: "auto",
      }}>
        <div className="chat-header">
          <div className="header-info">
            <ChatbotIcon />
            <h2 className="logo-text">GATE AI Energy Facility Manager</h2>
          </div>

          <button
            className="material-symbols-rounded"
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
          >
            keyboard_arrow_down
          </button>
        </div>

        <div ref={chatBodyRef} className="chat-body">
          <div className="message bot-message">
            <ChatbotIcon />
            <p className="message-text">
              This is your GATE AI facility Manager. How can I assist you today?
            </p>
          </div>

          {chatHistory.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))}
        </div>

        <div className="chat-footer">
          <ChatForm
            chatHistory={chatHistory}
            setChatHistory={setChatHistory}
            generateBotResponse={generateBotResponse}
          />
        </div>
      </div>
    </div>
  );
};

export default FacilityChatbot;
