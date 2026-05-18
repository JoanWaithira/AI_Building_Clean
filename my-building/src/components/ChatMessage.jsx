import ChatbotIcon from "./ChatbotIcon";

const ChatMessage = ({ message }) => {
    return (
        <div className={`message ${message.sender === "bot" ? 'bot' : 'user'}-message`}>
            {message.sender === "bot" && <ChatbotIcon />}
            <p className="message-text">{message.text}</p>
        </div>
    );
};

export default ChatMessage;