import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageCircle,
  Send,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { useChatMessages } from '../hooks/useChatMessages';
import ChatBubble from './ChatBubble';

/**
 * LeagueChat component - Collapsible chat panel for league communication
 *
 * Features:
 * - Real-time message display using Supabase Realtime
 * - Auto-scroll to bottom on new messages
 * - Different styling for user vs system messages
 * - Rate-limited message sending
 * - Connection status indicator
 * - Load more (older messages)
 */
function LeagueChat({ supabase, leagueId, leagueName, user, isOpen, onToggle, unreadCount = 0 }) {
  const [inputMessage, setInputMessage] = useState('');
  const [sendError, setSendError] = useState(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  const {
    messages,
    loading,
    error,
    hasMore,
    sending,
    connectionStatus,
    sendMessage,
    loadMore,
    refresh
  } = useChatMessages(supabase, leagueId, user);

  // Auto-scroll to bottom when new messages arrive (if user is at bottom)
  useEffect(() => {
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isAtBottom]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Track scroll position
  const handleScroll = useCallback((e) => {
    const container = e.target;
    const threshold = 100; // pixels from bottom
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setIsAtBottom(isNearBottom);

    // Load more when scrolled to top
    if (container.scrollTop < 50 && hasMore && !loading) {
      loadMore();
    }
  }, [hasMore, loading, loadMore]);

  // Handle send message
  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!inputMessage.trim() || sending) return;

    setSendError(null);
    const result = await sendMessage(inputMessage);

    if (result.success) {
      setInputMessage('');
      setIsAtBottom(true);
      // Scroll to bottom after sending
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } else {
      setSendError(result.error);
      setTimeout(() => setSendError(null), 3000);
    }
  };

  // Handle key press (Enter to send, Shift+Enter for newline)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // Handle paste - prevent image paste errors
  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          setSendError('Image paste is not supported. Please share image links instead.');
          setTimeout(() => setSendError(null), 3000);
          return;
        }
      }
    }
  };

  // Scroll to bottom button
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
  };

  // Connection status indicator
  const ConnectionStatus = () => {
    const statusConfig = {
      connected: { icon: Wifi, color: 'text-green-400', pulse: true },
      connecting: { icon: Wifi, color: 'text-yellow-400', pulse: true },
      disconnected: { icon: WifiOff, color: 'text-red-400', pulse: false },
      error: { icon: AlertCircle, color: 'text-red-400', pulse: false }
    };

    const config = statusConfig[connectionStatus] || statusConfig.disconnected;
    const Icon = config.icon;

    return (
      <div className={`flex items-center gap-1 ${config.color}`}>
        <div className={`relative ${config.pulse ? 'animate-pulse' : ''}`}>
          <Icon className="w-3 h-3" />
        </div>
      </div>
    );
  };

  // Collapsed state - just show toggle button
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="
          fixed bottom-4 right-4 z-40
          flex items-center gap-2 px-4 py-3
          bg-bpNavy border-2 border-bpGold/50 rounded-full
          text-bpCream hover:border-bpGold
          shadow-lg hover:shadow-xl
          transition-all duration-200
        "
      >
        <MessageCircle className="w-5 h-5 text-bpGold" />
        <span className="font-medium">League Chat</span>
        {unreadCount > 0 && (
          <span className="
            absolute -top-1 -right-1
            bg-bpRed text-white text-xs font-bold
            w-5 h-5 rounded-full
            flex items-center justify-center
          ">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  // Expanded state - full chat panel
  return (
    <div className="
      fixed bottom-4 right-4 z-40
      w-80 sm:w-96 h-[500px] max-h-[70vh]
      bg-bpNavy border-2 border-bpGold/30 rounded-2xl
      shadow-2xl flex flex-col overflow-hidden
    ">
      {/* Header */}
      <div className="
        flex items-center justify-between
        px-4 py-3 bg-bpNavy/90 border-b border-bpGold/20
      ">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-bpGold" />
          <div>
            <h3 className="font-semibold text-bpCream text-sm">League Chat</h3>
            <p className="text-xs text-gray-400 truncate max-w-[150px]">
              {leagueName || 'Chat'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionStatus />
          <button
            onClick={refresh}
            className="p-1.5 hover:bg-gray-700/50 rounded-lg transition-colors"
            title="Refresh messages"
          >
            <RefreshCw className="w-4 h-4 text-gray-400 hover:text-bpCream" />
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 hover:bg-gray-700/50 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-gray-400 hover:text-bpCream" />
          </button>
        </div>
      </div>

      {/* Messages Container */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-gray-600"
      >
        {/* Loading indicator for older messages */}
        {loading && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <Loader2 className="w-5 h-5 text-bpGold animate-spin" />
          </div>
        )}

        {/* Load more button */}
        {hasMore && !loading && messages.length > 0 && (
          <button
            onClick={loadMore}
            className="
              w-full py-2 text-xs text-gray-400
              hover:text-bpGold hover:bg-gray-800/50
              transition-colors
            "
          >
            <ChevronUp className="w-4 h-4 mx-auto" />
            Load older messages
          </button>
        )}

        {/* Initial loading state */}
        {loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-8">
            <Loader2 className="w-8 h-8 text-bpGold animate-spin mb-2" />
            <p className="text-gray-400 text-sm">Loading messages...</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center h-full py-8 px-4">
            <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
            <p className="text-red-400 text-sm text-center">{error}</p>
            <button
              onClick={refresh}
              className="mt-2 text-bpGold text-sm hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-8 px-4">
            <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
            <p className="text-gray-400 text-sm text-center">
              No messages yet. Be the first to say something!
            </p>
            <p className="text-gray-500 text-xs text-center mt-2">
              System updates will appear here automatically.
            </p>
          </div>
        )}

        {/* Messages list */}
        {messages.map((message, index) => (
          <ChatBubble
            key={message.id}
            message={message}
            currentUserId={user?.id}
            showTimestamp={
              // Show timestamp if it's the last message or if there's a gap > 5 mins
              index === messages.length - 1 ||
              (messages[index + 1] &&
                new Date(messages[index + 1].created_at) - new Date(message.created_at) > 300000)
            }
          />
        ))}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && messages.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="
            absolute bottom-20 right-4
            p-2 bg-bpGold text-bpNavy rounded-full
            shadow-lg hover:bg-bpGold/90
            transition-all duration-200
          "
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}

      {/* Send error toast */}
      {sendError && (
        <div className="
          absolute bottom-16 left-4 right-4
          bg-red-900/90 border border-red-500/50
          text-red-200 text-xs px-3 py-2 rounded-lg
        ">
          {sendError}
        </div>
      )}

      {/* Input Area */}
      <form
        onSubmit={handleSendMessage}
        className="p-3 bg-gray-900/50 border-t border-bpGold/20"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a message..."
            rows={1}
            className="
              flex-1 px-3 py-2 bg-gray-800/80 border border-gray-600
              rounded-xl text-bpCream text-sm placeholder-gray-500
              focus:outline-none focus:border-bpGold/50
              resize-none max-h-24
            "
            style={{
              minHeight: '40px',
              height: 'auto'
            }}
            disabled={sending || !user}
          />
          <button
            type="submit"
            disabled={!inputMessage.trim() || sending || !user}
            className="
              p-2.5 bg-bpGold text-bpNavy rounded-xl
              hover:bg-bpGold/90 disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>

        {!user && (
          <p className="text-xs text-gray-500 mt-2 text-center">
            Sign in to send messages
          </p>
        )}
      </form>
    </div>
  );
}

export default LeagueChat;
