import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for managing league chat messages with real-time subscriptions
 *
 * @param {Object} supabase - Supabase client instance
 * @param {string} leagueId - The league ID to fetch messages for
 * @param {Object} user - Current authenticated user
 * @param {number} initialLimit - Number of messages to load initially (default: 50)
 */
export function useChatMessages(supabase, leagueId, user, initialLimit = 50) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const channelRef = useRef(null);
  const lastMessageTimeRef = useRef(null);

  // Fetch initial messages
  const fetchMessages = useCallback(async (limit = initialLimit, before = null) => {
    if (!leagueId) return;

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('league_messages')
        .select(`
          id,
          league_id,
          user_id,
          message_type,
          content,
          metadata,
          created_at
        `)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (before) {
        query = query.lt('created_at', before);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        throw fetchError;
      }

      // Reverse to show oldest first (for chat display)
      const sortedMessages = (data || []).reverse();

      if (before) {
        // Prepend older messages
        setMessages(prev => [...sortedMessages, ...prev]);
      } else {
        setMessages(sortedMessages);
      }

      setHasMore((data || []).length === limit);
    } catch (err) {
      console.error('Error fetching messages:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [supabase, leagueId, initialLimit]);

  // Load more (older) messages
  const loadMore = useCallback(async () => {
    if (!hasMore || loading || messages.length === 0) return;

    const oldestMessage = messages[0];
    await fetchMessages(initialLimit, oldestMessage.created_at);
  }, [fetchMessages, hasMore, loading, messages, initialLimit]);

  // Send a user message
  const sendMessage = useCallback(async (content) => {
    if (!leagueId || !user || !content.trim()) {
      return { success: false, error: 'Invalid message' };
    }

    // Rate limiting check (client-side)
    const now = Date.now();
    if (lastMessageTimeRef.current && (now - lastMessageTimeRef.current) < 3000) {
      return { success: false, error: 'Please wait before sending another message' };
    }

    setSending(true);

    try {
      // Use the RPC function for rate-limited message sending
      const { data, error: rpcError } = await supabase.rpc('send_chat_message', {
        p_league_id: leagueId,
        p_user_id: user.id,
        p_content: content.trim()
      });

      if (rpcError) {
        throw rpcError;
      }

      if (!data.success) {
        return { success: false, error: data.error };
      }

      lastMessageTimeRef.current = now;

      // Optimistic update - add message immediately
      const optimisticMessage = {
        id: data.message_id,
        league_id: leagueId,
        user_id: user.id,
        message_type: 'user',
        content: content.trim(),
        metadata: {
          username: user.user_metadata?.username || user.email
        },
        created_at: new Date().toISOString()
      };

      setMessages(prev => [...prev, optimisticMessage]);

      return { success: true, message_id: data.message_id };
    } catch (err) {
      console.error('Error sending message:', err);
      return { success: false, error: err.message };
    } finally {
      setSending(false);
    }
  }, [supabase, leagueId, user]);

  // Set up real-time subscription
  useEffect(() => {
    if (!leagueId) return;

    // Fetch initial messages
    fetchMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel(`league-chat-${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'league_messages',
          filter: `league_id=eq.${leagueId}`
        },
        (payload) => {
          const newMessage = payload.new;

          // Avoid duplicates (especially from optimistic updates)
          setMessages(prev => {
            const exists = prev.some(m => m.id === newMessage.id);
            if (exists) {
              // Update the existing message with server data
              return prev.map(m => m.id === newMessage.id ? newMessage : m);
            }
            return [...prev, newMessage];
          });
        }
      )
      .on('subscribe', (status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
        } else if (status === 'CHANNEL_ERROR') {
          setConnectionStatus('error');
        }
      })
      .subscribe();

    channelRef.current = channel;
    setConnectionStatus('connecting');

    // Cleanup subscription on unmount or league change
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setConnectionStatus('disconnected');
    };
  }, [supabase, leagueId, fetchMessages]);

  // Refresh messages manually
  const refresh = useCallback(() => {
    setMessages([]);
    fetchMessages();
  }, [fetchMessages]);

  // Get unread count (messages since last viewed)
  const getUnreadCount = useCallback((lastViewedAt) => {
    if (!lastViewedAt) return messages.length;
    return messages.filter(m => new Date(m.created_at) > new Date(lastViewedAt)).length;
  }, [messages]);

  return {
    messages,
    loading,
    error,
    hasMore,
    sending,
    connectionStatus,
    sendMessage,
    loadMore,
    refresh,
    getUnreadCount
  };
}

export default useChatMessages;
