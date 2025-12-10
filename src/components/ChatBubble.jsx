import React from 'react';
import {
  Car,
  TrendingUp,
  TrendingDown,
  Clock,
  Trophy,
  PartyPopper,
  AlertCircle,
  User
} from 'lucide-react';

/**
 * ChatBubble component for rendering individual chat messages
 * Supports both user messages and system messages with different styles
 */
function ChatBubble({ message, currentUserId, showTimestamp = true }) {
  const isOwnMessage = message.user_id === currentUserId;
  const isSystemMessage = message.user_id === null || message.message_type !== 'user';

  // Format timestamp
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // Get icon for system message type
  const getSystemIcon = (messageType) => {
    switch (messageType) {
      case 'system_car_picked':
        return <Car className="w-4 h-4" />;
      case 'system_price_update':
        const percentChange = message.metadata?.percent_change || 0;
        return percentChange > 0
          ? <TrendingUp className="w-4 h-4 text-green-400" />
          : <TrendingDown className="w-4 h-4 text-red-400" />;
      case 'system_auction_ending':
        return <Clock className="w-4 h-4 text-yellow-400" />;
      case 'system_auction_ended':
        return <Trophy className="w-4 h-4 text-bpGold" />;
      case 'system_big_move':
        return <PartyPopper className="w-4 h-4 text-green-400" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  // Get background color based on message type
  const getSystemBgColor = (messageType) => {
    switch (messageType) {
      case 'system_car_picked':
        return 'bg-blue-900/30 border-blue-500/30';
      case 'system_price_update':
        const percentChange = message.metadata?.percent_change || 0;
        return percentChange > 0
          ? 'bg-green-900/30 border-green-500/30'
          : 'bg-red-900/30 border-red-500/30';
      case 'system_auction_ending':
        return 'bg-yellow-900/30 border-yellow-500/30';
      case 'system_auction_ended':
        return 'bg-bpGold/10 border-bpGold/30';
      case 'system_big_move':
        return 'bg-green-900/40 border-green-400/40';
      default:
        return 'bg-gray-800/50 border-gray-600/30';
    }
  };

  // Get username from metadata or message
  const getUsername = () => {
    if (message.metadata?.username) {
      return message.metadata.username;
    }
    return 'Unknown User';
  };

  // Render system message
  if (isSystemMessage) {
    return (
      <div className="flex justify-center my-2 px-2">
        <div
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg border
            text-xs text-gray-300 max-w-[90%]
            ${getSystemBgColor(message.message_type)}
          `}
        >
          <span className="flex-shrink-0">
            {getSystemIcon(message.message_type)}
          </span>
          <span className="flex-1 text-center">
            {message.content}
          </span>
          {message.metadata?.image_url && (
            <img
              src={message.metadata.image_url}
              alt=""
              className="w-8 h-8 rounded object-cover flex-shrink-0"
              onError={(e) => e.target.style.display = 'none'}
            />
          )}
        </div>
      </div>
    );
  }

  // Render user message
  return (
    <div
      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-3 px-2`}
    >
      <div
        className={`
          flex flex-col max-w-[75%]
          ${isOwnMessage ? 'items-end' : 'items-start'}
        `}
      >
        {/* Username (only for other users) */}
        {!isOwnMessage && (
          <div className="flex items-center gap-1 mb-1 px-1">
            <div className="w-5 h-5 rounded-full bg-bpGold/20 flex items-center justify-center">
              <User className="w-3 h-3 text-bpGold" />
            </div>
            <span className="text-xs text-bpGold font-medium">
              {getUsername()}
            </span>
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`
            px-3 py-2 rounded-2xl break-words
            ${isOwnMessage
              ? 'bg-bpGold text-bpNavy rounded-br-md'
              : 'bg-gray-700/80 text-gray-100 rounded-bl-md'
            }
          `}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Timestamp */}
        {showTimestamp && (
          <span className="text-[10px] text-gray-500 mt-1 px-1">
            {formatTime(message.created_at)}
          </span>
        )}
      </div>
    </div>
  );
}

export default ChatBubble;
