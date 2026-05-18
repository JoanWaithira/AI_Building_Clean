import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportEnergyReportPDF({ baseline, circuitRows, tariffRate, budgetMonthly }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const DARK = [30, 41, 59];
  const MUTED = [100, 116, 139];

  doc.setFillColor(10, 15, 26);
  doc.rect(0, 0, 210, 38, 'F');
  doc.setFillColor(125, 211, 252);
  doc.rect(0, 0, 4, 38, 'F');
  doc.setTextColor(125, 211, 252);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('GATE Digital Twin', 12, 14);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('Monthly Energy Performance Report', 12, 22);
  doc.text(monthLabel, 12, 30);

  let y = 46;

  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('Key Performance Indicators', 14, y); y += 5;

  const budgetNote = budgetMonthly
    ? (baseline.monthlyCost > budgetMonthly
        ? `OVER BUDGET by €${(baseline.monthlyCost - budgetMonthly).toFixed(0)}`
        : `€${(budgetMonthly - baseline.monthlyCost).toFixed(0)} under budget`)
    : 'Budget not set';

  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Value', 'Status']],
    body: [
      ['Monthly cost (est.)', `€${baseline.monthlyCost.toFixed(0)}`, budgetNote],
      ['Daily energy use', `${baseline.dailyKwh.toFixed(1)} kWh`, ''],
      ['Annual energy use', `${baseline.annualKwh.toFixed(0)} kWh`, ''],
      ['EPC rating', baseline.epcRating, baseline.epcRating <= 'B' ? 'Good' : 'Needs attention'],
      ['Carbon footprint', `${baseline.carbonTonYear.toFixed(2)} tCO₂/yr`, ''],
      ['After-hours waste', `${baseline.afterHoursRatio.toFixed(0)}%`, baseline.afterHoursRatio > 20 ? 'Reduce overnight load' : 'Acceptable'],
      ['Peak load', `${(baseline.peakW / 1000).toFixed(1)} kW`, ''],
      ['Tariff rate applied', `€${tariffRate}/kWh`, budgetMonthly ? `Budget: €${budgetMonthly}` : ''],
    ],
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, textColor: DARK },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('Circuit Energy Breakdown', 14, y); y += 5;

  autoTable(doc, {
    startY: y,
    head: [['#', 'Circuit', 'Tier', 'kWh/day', '€/month (est.)']],
    body: circuitRows.map((c, i) => [
      `#${i + 1}`,
      c.label,
      c.tier,
      c.dailyKwh.toFixed(1),
      `€${(c.dailyKwh * 22 * tariffRate).toFixed(0)}`,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, textColor: DARK },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    margin: { left: 14, right: 14 },
    columnStyles: { 0: { cellWidth: 10 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 }, 4: { cellWidth: 30 } },
  });

  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(`GATE Digital Twin · Energy Report · ${new Date().toLocaleString()}`, 14, 289);
    doc.text(`Page ${i} / ${total}`, 196, 289, { align: 'right' });
  }

  doc.save(`gate-energy-report-${new Date().toISOString().slice(0, 7)}.pdf`);
}

export function exportFaultsCSV(faults, acks = {}) {
  const headers = ['Severity', 'Label', 'Category', 'Circuit/Room', 'Weekly Cost €', 'Status', 'Description'];
  const rows = faults.map(f => {
    const key = faultAckKey(f);
    const status = acks[key]?.status ?? 'active';
    return [
      f.severity,
      `"${f.label}"`,
      f.category,
      f.data?.circuit ?? f.data?.room ?? '',
      (f.weeklyCost ?? 0).toFixed(2),
      status,
      `"${(f.description ?? '').replace(/"/g, "'")}"`,
    ];
  });
  downloadText([headers, ...rows].map(r => r.join(',')).join('\n'), 'gate-faults.csv', 'text/csv');
}

export function exportCircuitCSV(rows, circuitId) {
  const headers = ['Timestamp', 'Power (W)', 'Circuit'];
  const body = rows.map(r => [r.ts_5min, r.value, r.circuit_id ?? circuitId]);
  downloadText([headers, ...body].map(r => r.join(',')).join('\n'), `gate-circuit-${circuitId}.csv`, 'text/csv');
}

export function faultAckKey(fault) {
  return `${fault.id}__${fault.data?.circuit ?? fault.data?.room ?? 'building'}`;
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
