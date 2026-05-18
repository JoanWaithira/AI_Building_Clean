import { useRef } from "react";



// -------------------- COMPONENT --------------------
const ChatForm = ({ chatHistory, setChatHistory, generateBotResponse }) => {
  const inputRef = useRef();

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    const userMessage = inputRef.current.value.trim();
    if (!userMessage) return;
    inputRef.current.value = "";

    const visibleUserMsg = { sender: "user", text: userMessage };

    const baseHistory = [...(chatHistory || [])].filter(
      (m) => !m?.isThinking && m?.sender !== "system"
    );
    const updatedHistory = [...baseHistory, visibleUserMsg];

    // Show user message + typing indicator
    setChatHistory((prev) => [
      ...prev,
      visibleUserMsg,
      { sender: "bot", text: "Facility Manager is typing...", isThinking: true },
    ]);

    await generateBotResponse(updatedHistory, userMessage);
  };

  return (
    <form action="#" className="chat-form" onSubmit={handleFormSubmit}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Type your message here..."
        className="message-input"
        required
      />
      <button type="submit" className="material-symbols-rounded">
        arrow_upward
      </button>
    </form>
  );
};

export default ChatForm;