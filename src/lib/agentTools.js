import { prisma } from '@/lib/prisma';

export const agentToolsDeclaration = {
  functionDeclarations: [
    {
      name: 'addExpense',
      description: 'Lưu hoặc thêm một khoản chi tiêu mới vào cơ sở dữ liệu.',
      parameters: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING', description: 'Mô tả khoản chi tiêu (ví dụ: Ăn phở, Đổ xăng, Mua máy tính)' },
          amount: { type: 'NUMBER', description: 'Số tiền bằng VNĐ (kiểu số nguyên, ví dụ: 50000, 30000000)' },
          category: { type: 'STRING', description: 'Danh mục chi tiêu (chọn một trong: Ăn uống, Đi lại, Mua sắm, Hóa đơn, Giải trí, Khác)' }
        },
        required: ['description', 'amount']
      }
    },
    {
      name: 'deleteExpense',
      description: 'Tìm và xóa khoản chi tiêu khỏi cơ sở dữ liệu theo từ khóa mô tả (ví dụ: "phở", "xăng") hoặc ID.',
      parameters: {
        type: 'OBJECT',
        properties: {
          keyword: { type: 'STRING', description: 'Từ khóa liên quan tới khoản chi tiêu muốn xóa (ví dụ: "phở", "máy tính")' },
          expenseId: { type: 'NUMBER', description: 'ID chính xác của khoản chi tiêu nếu biết' }
        }
      }
    },
    {
      name: 'getExpenseSummary',
      description: 'Tra cứu báo cáo thống kê chi tiêu, tính tổng số tiền hoặc lọc theo danh mục.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', description: 'Tên danh mục muốn lọc (tùy chọn)' }
        }
      }
    }
  ]
};

export async function executeAgentTool(toolName, args) {
  try {
    if (toolName === 'addExpense') {
      const amount = Number(args.amount);
      const newExpense = await prisma.expense.create({
        data: {
          description: String(args.description),
          amount: isNaN(amount) ? 0 : amount,
          category: String(args.category || 'Khác'),
        }
      });
      return { success: true, action: 'add', expense: newExpense };
    }

    if (toolName === 'deleteExpense') {
      let expenseToDelete = null;
      if (args.expenseId) {
        expenseToDelete = await prisma.expense.findUnique({ where: { id: Number(args.expenseId) } });
      } else if (args.keyword) {
        const matching = await prisma.expense.findMany({
          where: { description: { contains: String(args.keyword) } },
          orderBy: { createdAt: 'desc' },
          take: 1
        });
        if (matching.length > 0) expenseToDelete = matching[0];
      }

      if (!expenseToDelete) {
        return { success: false, error: `Không tìm thấy khoản chi tiêu nào chứa từ khóa "${args.keyword || args.expenseId}" để xóa.` };
      }

      await prisma.expense.delete({ where: { id: expenseToDelete.id } });
      return { success: true, action: 'delete', deletedExpense: expenseToDelete };
    }

    if (toolName === 'getExpenseSummary') {
      const where = args.category ? { category: String(args.category) } : {};
      const expenses = await prisma.expense.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 });
      const total = expenses.reduce((sum, item) => sum + item.amount, 0);
      return { success: true, action: 'summary', total, count: expenses.length, expenses };
    }

    return { success: false, error: `Unknown tool: ${toolName}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
