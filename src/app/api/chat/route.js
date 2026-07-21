import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import { agentToolsDeclaration, executeAgentTool } from '@/lib/agentTools';

export async function POST(request) {
  try {
    const { message, history } = await request.json();

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Nội dung tin nhắn không hợp lệ.' }, { status: 400 });
    }

    let openrouterKey = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').split('#')[0].trim().replace(/^["']|["']$/g, '');
    let deepseekKey = (process.env.DEEPSEEK_API_KEY || '').split('#')[0].trim().replace(/^["']|["']$/g, '');
    let geminiKey = (process.env.GEMINI_API_KEY || '').split('#')[0].trim().replace(/^["']|["']$/g, '');

    const systemInstruction = `Bạn là DailyBee AI Agent - Tác tử AI quản lý chi tiêu thông minh.
Bạn có quyền gọi các công cụ (Tools) để trực tiếp tương tác với cơ sở dữ liệu:
- addExpense: Thêm khoản chi tiêu mới.
- deleteExpense: Xóa khoản chi tiêu theo từ khóa mô tả hoặc ID.
- getExpenseSummary: Tra cứu báo cáo thống kê chi tiêu hoặc tính tổng tiền.

HƯỚNG DẪN HÀNH ĐỘNG:
1. Khi người dùng báo khoản chi tiêu (ví dụ: "Sáng nay ăn phở 45k", "Mua máy tính 30tr"), BẮT BUỘC phải gọi công cụ 'addExpense'.
2. Khi người dùng bảo xóa hoặc nãy nhập sai (ví dụ: "Xóa khoản phở nãy đi"), BẮT BUỘC gọi công cụ 'deleteExpense'.
3. Khi người dùng hỏi tổng tiền hoặc báo cáo (ví dụ: "Xem ăn uống hết bao nhiêu rồi"), BẮT BUỘC gọi công cụ 'getExpenseSummary'.
4. Phản hồi bằng tiếng Việt thân thiện, rõ ràng, trình bày đẹp mắt.`;

    let replyText = '';
    let executedActions = [];

    // OPTION 1: OPENROUTER API (DeepSeek V3 / Llama / OpenAI)
    if (openrouterKey.startsWith('sk-or-v1-')) {
      const openAiTools = [
        {
          type: 'function',
          function: {
            name: 'addExpense',
            description: 'Lưu hoặc thêm một khoản chi tiêu mới vào cơ sở dữ liệu.',
            parameters: {
              type: 'object',
              properties: {
                description: { type: 'string', description: 'Mô tả khoản chi tiêu (ví dụ: Ăn phở, Đổ xăng, Mua máy tính)' },
                amount: { type: 'number', description: 'Số tiền bằng VNĐ (kiểu số nguyên, ví dụ: 50000, 30000000)' },
                category: { type: 'string', description: 'Danh mục chi tiêu: Ăn uống | Đi lại | Mua sắm | Hóa đơn | Giải trí | Khác' }
              },
              required: ['description', 'amount']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'deleteExpense',
            description: 'Tìm và xóa khoản chi tiêu khỏi cơ sở dữ liệu theo từ khóa hoặc ID.',
            parameters: {
              type: 'object',
              properties: {
                keyword: { type: 'string', description: 'Từ khóa chi tiêu muốn xóa (ví dụ: "phở", "máy tính")' },
                expenseId: { type: 'number', description: 'ID khoản chi chính xác' }
              }
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'getExpenseSummary',
            description: 'Tra cứu báo cáo thống kê chi tiêu.',
            parameters: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'Tên danh mục muốn lọc' }
              }
            }
          }
        }
      ];

      const messages = [
        { role: 'system', content: systemInstruction }
      ];

      (history || []).slice(-6).forEach(h => {
        messages.push({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: String(h.text || '')
        });
      });

      messages.push({ role: 'user', content: message.trim() });

      let currentMessages = [...messages];
      let selectedModel = 'deepseek/deepseek-chat';

      let openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'DailyBee Agent'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: currentMessages,
          tools: openAiTools
        })
      });

      if (!openRouterRes.ok) {
        const errText = await openRouterRes.text();
        console.error('OpenRouter Error:', errText);
        throw new Error(`Lỗi từ OpenRouter API (${openRouterRes.status}): ${errText}`);
      }

      let responseData = await openRouterRes.json();
      let assistantMsg = responseData.choices?.[0]?.message;

      // ReAct Loop for OpenRouter Tool Calling
      while (assistantMsg && assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        currentMessages.push(assistantMsg);

        for (const toolCall of assistantMsg.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse(toolCall.function.arguments); } catch(e) {}

          console.log(`🤖 OpenRouter Agent executing Tool: [${fnName}]`, fnArgs);
          const toolResult = await executeAgentTool(fnName, fnArgs);
          executedActions.push(toolResult);

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }

        // Send tool execution results back to OpenRouter LLM for final response
        openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openrouterKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'DailyBee Agent'
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: currentMessages
          })
        });

        if (openRouterRes.ok) {
          responseData = await openRouterRes.json();
          assistantMsg = responseData.choices?.[0]?.message;
        } else {
          break;
        }
      }

      replyText = assistantMsg?.content || 'Đã thực hiện xong tác vụ.';
    }
    // OPTION 2: GOOGLE GEMINI API
    else if (geminiKey && geminiKey.length > 10) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const candidateModels = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.0-flash-lite'];

      let modelInstance = null;
      for (const modelName of candidateModels) {
        try {
          modelInstance = genAI.getGenerativeModel({
            model: modelName,
            tools: [agentToolsDeclaration],
            systemInstruction
          });
          break;
        } catch (e) {}
      }

      if (!modelInstance) throw new Error('Không thể khởi tạo Gemini Agent.');

      const rawHistory = (history || []).slice(0, -1);
      const formattedHistory = [];
      for (const item of rawHistory) {
        const role = item.role === 'user' ? 'user' : 'model';
        const text = String(item.text || '').trim();
        if (!text) continue;
        if (formattedHistory.length === 0) {
          if (role === 'user') formattedHistory.push({ role: 'user', parts: [{ text }] });
        } else {
          const lastRole = formattedHistory[formattedHistory.length - 1].role;
          if (role !== lastRole) formattedHistory.push({ role, parts: [{ text }] });
        }
      }

      const chat = modelInstance.startChat({ history: formattedHistory });
      let result = await chat.sendMessage(message.trim());
      let response = await result.response;
      let functionCalls = response.functionCalls();

      while (functionCalls && functionCalls.length > 0) {
        const toolResponses = [];
        for (const call of functionCalls) {
          const toolResult = await executeAgentTool(call.name, call.args);
          executedActions.push(toolResult);
          toolResponses.push({ functionResponse: { name: call.name, response: toolResult } });
        }
        result = await chat.sendMessage(toolResponses);
        response = await result.response;
        functionCalls = response.functionCalls();
      }

      replyText = response.text() || 'Đã xử lý yêu cầu.';
    } else {
      return NextResponse.json({ error: 'Chưa cấu hình API Key hợp lệ trong file .env.' }, { status: 500 });
    }

    // Save user message and bot reply to Database for persistent chat history
    try {
      try {
        await prisma.chatMessage.create({ data: { role: 'user', text: message.trim() } });
      } catch (e) {
        await prisma.$executeRaw`INSERT INTO ChatMessage (role, text, createdAt) VALUES ('user', ${message.trim()}, datetime('now'))`;
      }

      if (replyText) {
        try {
          await prisma.chatMessage.create({ data: { role: 'bot', text: replyText } });
        } catch (e) {
          await prisma.$executeRaw`INSERT INTO ChatMessage (role, text, createdAt) VALUES ('bot', ${replyText}, datetime('now'))`;
        }
      }
    } catch (dbErr) {
      console.warn('Failed to save chat message to DB:', dbErr.message);
    }

    return NextResponse.json({
      success: true,
      reply: replyText,
      actions: executedActions
    });

  } catch (error) {
    console.error('Error in Agent Execution:', error);
    return NextResponse.json({ error: error.message || 'Có lỗi xảy ra khi xử lý tác vụ.' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const checkQuota = searchParams.get('checkQuota');

    if (checkQuota === 'true') {
      let openrouterKey = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').split('#')[0].trim().replace(/^["']|["']$/g, '');
      if (openrouterKey.startsWith('sk-or-v1-')) {
        return NextResponse.json({
          ok: true,
          model: 'deepseek/deepseek-chat (OpenRouter)',
          rpmLimit: 'Không giới hạn (Pay-as-you-go)',
          rpdLimit: 'Vô hạn',
          tpmLimit: 128000,
          statusText: '🟢 Kết nối DeepSeek ổn định',
          provider: 'OpenRouter / DeepSeek AI'
        });
      }

      let apiKey = (process.env.GEMINI_API_KEY || '').split('#')[0].trim().replace(/^["']|["']$/g, '');
      if (!apiKey || apiKey.length < 10) {
        return NextResponse.json({ 
          ok: false, 
          statusText: 'Chưa cấu hình API Key', 
          details: 'Thiếu OPENROUTER_API_KEY / GEMINI_API_KEY trong file .env' 
        });
      }

      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
        const ping = await model.generateContent("ping");
        if (ping) {
          return NextResponse.json({
            ok: true,
            model: 'gemini-flash-latest',
            rpmLimit: 15,
            rpdLimit: 1500,
            tpmLimit: 1000000,
            statusText: '🟢 Kết nối Google ổn định',
            provider: 'Google Gemini AI (Free Tier)'
          });
        }
      } catch (err) {
        return NextResponse.json({
          ok: false,
          statusText: '🔴 Lỗi kết nối AI',
          details: err.message,
          provider: 'AI Provider'
        });
      }
    }

    const expenses = await prisma.expense.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const total = expenses.reduce((sum, item) => sum + item.amount, 0);

    let chatMessages = [];
    try {
      chatMessages = await prisma.chatMessage.findMany({
        orderBy: { createdAt: 'asc' },
        take: 100
      });
    } catch (e) {
      try {
        chatMessages = await prisma.$queryRaw`SELECT id, role, text, createdAt FROM ChatMessage ORDER BY createdAt ASC LIMIT 100`;
      } catch (err) {}
    }

    return NextResponse.json({ expenses, total, chatMessages });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return NextResponse.json({ error: 'Không thể tải dữ liệu.' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    try {
      await prisma.chatMessage.deleteMany({});
    } catch (e) {
      await prisma.$executeRaw`DELETE FROM ChatMessage`;
    }
    return NextResponse.json({ success: true, message: 'Đã xóa toàn bộ lịch sử chat.' });
  } catch (err) {
    return NextResponse.json({ error: 'Không thể xóa lịch sử chat.' }, { status: 500 });
  }
}
