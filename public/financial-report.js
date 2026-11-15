const jakartaDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function reportDay(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(jakartaDay.formatToParts(date).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function reportRange(day, period) {
  const start = new Date(day + 'T00:00:00Z');
  const end = new Date(start);
  if (period === 'week') {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (period === 'month') {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

function unitCost(item) {
  const cost = item.parts
    ? item.parts.reduce((sum, part) => sum + (Number(part.cost) || 0) * part.qty, 0) / item.qty
    : Number(item.cost) || 0;
  return { cost, incomplete: cost <= 0 || [...(item.parts || []), ...(item.components || [])].some(part => Number(part.cost) <= 0 || part.cost == null) };
}

export function financialReport(state, from, through, channel) {
  const inside = day => day >= from && day <= through;
  const rows = [];
  let pending = 0;
  for (const sale of state.sales) {
    if ((channel && sale.channel !== channel) || sale.status === 'Dibatalkan') continue;
    const store = sale.channel === 'Toko';
    const billed = sale.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (!store && !sale.settlement) {
      if (inside(reportDay(sale.at))) pending++;
      continue;
    }
    if (store && sale.status !== 'Selesai') continue;
    const day = reportDay(store ? sale.at : sale.settlement.at);
    if (!day) continue;
    const costs = sale.items.map(unitCost);
    const cogs = sale.items.reduce((sum, item, index) => sum + costs[index].cost * item.qty, 0);
    const fee = store ? 0 : sale.settlement.fee;
    const net = store ? billed : sale.settlement.payout;
    if (inside(day)) rows.push({ sale, day, kind: 'Penjualan', net, fee, cogs, incomplete: costs.some(item => item.incomplete) });
    if (sale.returnResult) {
      const returnDay = reportDay(sale.returnResult.at);
      const adjustmentDay = returnDay && (returnDay > day ? returnDay : day);
      const credit = (sale.returnResult.quantities || []).reduce((sum, qty, index) => sum + (Number(qty) || 0) * (costs[index]?.cost || 0), 0);
      if (inside(adjustmentDay) && sale.returnResult.quantities?.some(qty => Number(qty) > 0)) {
        rows.push({ sale, day: adjustmentDay, kind: 'Stok retur siap jual', net: 0, fee: 0, cogs: -credit, incomplete: costs.some(item => item.incomplete) });
      }
    }
  }
  rows.sort((a, b) => b.day.localeCompare(a.day));
  const expenses = channel ? [] : (state.expenses || []).filter(expense => inside(expense.day)).sort((a, b) => b.day.localeCompare(a.day));
  const purchases = channel ? 0 : state.purchases.filter(purchase => inside(reportDay(purchase.at)))
    .reduce((sum, purchase) => sum + (purchase.items ?? [purchase]).reduce((amount, item) => amount + item.qty * item.cost, 0), 0);
  const sum = key => rows.reduce((amount, row) => amount + row[key], 0);
  return { rows, expenses, purchases, pending, net: sum('net'), fee: sum('fee'), cogs: sum('cogs'),
    operating: expenses.reduce((amount, expense) => amount + expense.amount, 0),
    incomplete: new Set(rows.filter(row => row.incomplete).map(row => row.sale.id)).size };
}
