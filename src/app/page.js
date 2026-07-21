'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './page.module.css';

const CATEGORY_ICONS = {
  'Ăn uống': '🍔',
  'Đi lại': '⛽',
  'Mua sắm': '🛒',
  'Hóa đơn': '💡',
  'Giải trí': '🎬',
  'Khác': '📌'
};

export default function Home() {
  const [messages, setMessages] = useState([
    { 
      id: 'init-1', 
      role: 'bot', 
      text: 'Chào bạn! Mình là AI ghi chép chi tiêu DailyBee. Hôm nay bạn đã chi tiêu gì, hãy nhắn cho mình nhé! (Ví dụ: "Sáng nay ăn phở 45k")' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [totalExpense, setTotalExpense] = useState(0);
  const [allExpenses, setAllExpenses] = useState([]);
  
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState(null);
  const [isCheckingQuota, setIsCheckingQuota] = useState(false);

  const [showStatsModal, setShowStatsModal] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Fetch initial history on mount
  const loadInitialData = async () => {
    try {
      const res = await fetch('/api/chat');
      if (res.ok) {
        const data = await res.json();
        if (data.total !== undefined) {
          setTotalExpense(data.total);
        }
        if (data.expenses) {
          setAllExpenses(data.expenses);
        }
        if (data.chatMessages && data.chatMessages.length > 0) {
          setMessages(data.chatMessages.map((msg) => ({
            id: `msg-${msg.id}`,
            role: msg.role === 'user' ? 'user' : 'bot',
            text: msg.text
          })));
        }
      }
    } catch (err) {
      console.error('Failed to load initial expenses:', err);
    }
  };

  const handleClearChat = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử trò chuyện không?')) return;
    try {
      const res = await fetch('/api/chat', { method: 'DELETE' });
      if (res.ok) {
        setMessages([{
          id: 'init-1',
          role: 'bot',
          text: 'Chào bạn! Mình là AI ghi chép chi tiêu DailyBee. Hôm nay bạn đã chi tiêu gì, hãy nhắn cho mình nhé! (Ví dụ: "Sáng nay ăn phở 45k")'
        }]);
      }
    } catch (e) {
      console.error('Failed to clear chat:', e);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleCheckQuota = async () => {
    setShowQuotaModal(true);
    setIsCheckingQuota(true);
    try {
      const res = await fetch('/api/chat?checkQuota=true');
      const data = await res.json();
      setQuotaInfo(data);
    } catch (e) {
      setQuotaInfo({ ok: false, statusText: '🔴 Không thể kiểm tra' });
    } finally {
      setIsCheckingQuota(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    const userMsgId = `user-${Date.now()}-${Math.random()}`;
    const newMessages = [...messages, { id: userMsgId, role: 'user', text: userMsg }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Send chat history for Agent Short-Term Memory
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMsg,
          history: newMessages
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMessages(prev => [...prev, {
          id: `bot-${Date.now()}-${Math.random()}`,
          role: 'bot',
          text: data.reply
        }]);

        // If Agent performed DB actions (Add or Delete), refresh total & stats
        if (data.actions && data.actions.length > 0) {
          loadInitialData();
        }
      } else {
        const errorMsg = typeof data.error === 'string' ? data.error : 'Không thể xử lý tin nhắn.';
        setMessages(prev => [...prev, { 
          id: `err-${Date.now()}-${Math.random()}`, 
          role: 'bot', 
          text: `⚠️ Lỗi: ${errorMsg}` 
        }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { 
        id: `err-${Date.now()}-${Math.random()}`, 
        role: 'bot', 
        text: '⚠️ Xin lỗi, đã có lỗi kết nối xảy ra. Vui lòng kiểm tra lại mạng.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderFormattedText = (text) => {
    if (!text) return '';
    return String(text).split('\n').map((line, i) => (
      <span key={i}>
        {line.split('**').map((part, index) => 
           index % 2 === 1 ? <strong key={index}>{part}</strong> : 
           part.split('*').map((subpart, subindex) => 
              subindex % 2 === 1 ? <em key={subindex}>{subpart}</em> : subpart
           )
        )}
        <br/>
      </span>
    ));
  };

  // Calculate statistics per category
  const categoryStats = allExpenses.reduce((acc, item) => {
    const cat = item.category || 'Khác';
    acc[cat] = (acc[cat] || 0) + item.amount;
    return acc;
  }, {});

  const sortedCategories = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div style={{ background: 'var(--accent)', width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <h1>DailyBee AI</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Quản lý chi tiêu thông minh</span>
        </div>

        <button className={styles.quotaBtn} onClick={() => setShowStatsModal(true)} title="Xem báo cáo thống kê">
          📊 <span>Thống kê</span>
        </button>

        <button className={styles.quotaBtn} onClick={handleCheckQuota} title="Kiểm tra hạn mức AI">
          ⚡ <span>Quota</span>
        </button>

        <button className={styles.quotaBtn} onClick={handleClearChat} title="Xóa lịch sử trò chuyện">
          🗑️ <span>Xóa chat</span>
        </button>
      </header>

      <main className={styles.chatArea}>
        {messages.map((msg) => (
          <div key={msg.id} className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.userMessage : styles.botMessage}`}>
            <div className={styles.messageBubble}>
              {renderFormattedText(msg.text)}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className={`${styles.messageWrapper} ${styles.botMessage}`}>
            <div className={styles.messageBubble}>
               <div className={styles.loadingDot}></div>
               <div className={styles.loadingDot}></div>
               <div className={styles.loadingDot}></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <div className={styles.inputArea}>
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Nhập khoản chi tiêu (vd: Cơm trưa 35k)..."
            className={styles.input}
            disabled={isLoading}
          />
          <button type="submit" className={styles.button} disabled={isLoading || !input.trim()}>
            <svg className={styles.icon} viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </form>
      </div>

      {/* MODAL 1: Quota / AI Engine Status Modal */}
      {showQuotaModal && (
        <div className={styles.modalOverlay} onClick={() => setShowQuotaModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>⚡ Trạng Thái AI Engine</h2>
              <button className={styles.closeBtn} onClick={() => setShowQuotaModal(false)}>✕</button>
            </div>

            {isCheckingQuota ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-secondary)' }}>
                Đang kiểm tra kết nối tới AI Provider...
              </div>
            ) : quotaInfo ? (
              <div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px 14px', borderRadius: '12px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Trạng thái kết nối:</span>
                  <strong>{quotaInfo.statusText}</strong>
                </div>

                <div className={styles.quotaGrid}>
                  <div className={styles.quotaCard}>
                    <label>Tốc độ xử lý (RPM)</label>
                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#10b981' }}>
                      {typeof quotaInfo.rpmLimit === 'number' ? `${quotaInfo.rpmLimit} req/min` : (quotaInfo.rpmLimit || 'Không giới hạn')}
                    </span>
                  </div>
                  <div className={styles.quotaCard}>
                    <label>Hạn mức ngày (RPD)</label>
                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#8b5cf6' }}>
                      {typeof quotaInfo.rpdLimit === 'number' ? `${quotaInfo.rpdLimit} req/day` : (quotaInfo.rpdLimit || 'Vô hạn')}
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: '10px' }}>
                  <p>🌐 Nhà cung cấp: <strong>{quotaInfo.provider || 'OpenRouter / DeepSeek AI'}</strong></p>
                  <p style={{ marginTop: '4px' }}>🤖 Model AI: <strong>{quotaInfo.model || 'deepseek/deepseek-chat'}</strong></p>
                  <p style={{ marginTop: '4px' }}>⚡ Tác tử AI Agent: <strong>Function Calling Active</strong></p>
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
              <button 
                onClick={handleCheckQuota} 
                style={{ background: 'var(--accent)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '10px', cursor: 'pointer' }}>
                🔄 Kiểm tra lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Expense Statistics Modal */}
      {showStatsModal && (
        <div className={styles.modalOverlay} onClick={() => setShowStatsModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>📊 Báo Cáo Thống Kê Chi Tiêu</h2>
              <button className={styles.closeBtn} onClick={() => setShowStatsModal(false)}>✕</button>
            </div>

            <div style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(236,72,153,0.2) 100%)', border: '1px solid var(--glass-border)', padding: '1rem', borderRadius: '16px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tổng Chi Tiêu Đã Ghi:</span>
              <h2 style={{ fontSize: '1.6rem', color: 'white', marginTop: '4px' }}>{totalExpense.toLocaleString('vi-VN')}đ</h2>
            </div>

            {sortedCategories.length > 0 ? (
              <div className={styles.statList}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Phân bổ theo danh mục:</h4>
                {sortedCategories.map(([cat, amount]) => {
                  const percent = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
                  const icon = CATEGORY_ICONS[cat] || '📌';
                  return (
                    <div key={cat} className={styles.statItem}>
                      <div className={styles.statHeader}>
                        <span>{icon} {cat}</span>
                        <span><strong>{amount.toLocaleString('vi-VN')}đ</strong> ({percent}%)</span>
                      </div>
                      <div className={styles.progressTrack}>
                        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)' }}>
                Chưa có khoản chi tiêu nào được ghi nhận.
              </div>
            )}

            <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
              <button 
                onClick={() => setShowStatsModal(false)} 
                style={{ background: 'var(--accent)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '10px', cursor: 'pointer' }}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


