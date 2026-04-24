import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "./services/api";

const PERIODS = ["week", "month", "year"];

export default function App() {
  const [userPhone, setUserPhone] = useState("whatsapp:+919999999999");
  const [txText, setTxText] = useState("Spent 1250 on petrol today with GST 18%");
  const [kind, setKind] = useState("receipt");
  const [period, setPeriod] = useState("month");
  const [analysis, setAnalysis] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [file, setFile] = useState(null);

  const chartData = useMemo(() => {
    if (!analysis?.categoryTotals) return [];
    return Object.entries(analysis.categoryTotals).map(([name, value]) => ({ name, value }));
  }, [analysis]);

  const createTransaction = async () => {
    try {
      setStatus("Saving transaction...");
      await api.post("/transactions", { userPhone, text: txText });
      setStatus("Transaction added successfully");
      await fetchTransactions();
    } catch (error) {
      setStatus(error.response?.data?.message || "Failed to save transaction");
    }
  };

  const uploadDocument = async () => {
    if (!file) {
      setStatus("Select a file first");
      return;
    }

    try {
      setStatus("Uploading and analyzing document...");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userPhone", userPhone);
      formData.append("kind", kind);

      await api.post("/documents", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      setStatus("Document analyzed and saved");
      await Promise.all([fetchTransactions(), fetchAnalysis()]);
    } catch (error) {
      setStatus(error.response?.data?.message || "Document upload failed");
    }
  };

  const fetchTransactions = async () => {
    try {
      setStatus("Fetching transactions...");
      const { data } = await api.get("/transactions", { params: { userPhone } });
      setTransactions(data);
      setStatus("Transactions loaded");
    } catch (error) {
      setStatus(error.response?.data?.message || "Failed to fetch transactions");
    }
  };

  const fetchAnalysis = async () => {
    try {
      setStatus("Generating analysis...");
      const { data } = await api.get("/analysis", { params: { userPhone, period } });
      setAnalysis(data);
      setStatus("Analysis ready");
    } catch (error) {
      setStatus(error.response?.data?.message || "Failed to generate analysis");
    }
  };

  const downloadGstPdf = async () => {
    try {
      setStatus("Preparing GST PDF...");
      const response = await api.get("/gst/pdf", {
        params: { userPhone, period },
        responseType: "blob"
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `gst-report-${period}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setStatus("GST PDF downloaded");
    } catch (error) {
      setStatus(error.response?.data?.message || "Failed to download GST PDF");
    }
  };

  return (
    <div className="page">
      <div className="bg-orb orb-a" />
      <div className="bg-orb orb-b" />
      <header className="hero">
        <h1>WhatsApp Finance AI</h1>
        <p>Track transactions via text, voice, receipts, and bills. Generate analysis and GST-ready PDFs instantly.</p>
      </header>

      <section className="panel">
        <label>User WhatsApp Number</label>
        <input value={userPhone} onChange={(e) => setUserPhone(e.target.value)} placeholder="whatsapp:+91..." />
      </section>

      <section className="grid two">
        <div className="panel">
          <h2>Add Transaction by Text</h2>
          <textarea value={txText} onChange={(e) => setTxText(e.target.value)} rows={4} />
          <button onClick={createTransaction}>Save Transaction</button>
        </div>

        <div className="panel">
          <h2>Upload Receipt or Bill</h2>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="receipt">Receipt</option>
            <option value="bill">Bill</option>
            <option value="other">Other</option>
          </select>
          <input type="file" accept="image/*,application/pdf,audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button onClick={uploadDocument}>Upload and Analyze</button>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <h2>Period Analysis</h2>
          <div className="inline">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button onClick={fetchAnalysis}>Generate Analysis</button>
            <button className="secondary" onClick={downloadGstPdf}>
              Download GST PDF
            </button>
          </div>

          {analysis && (
            <div className="kpis">
              <div>Income: INR {analysis.income.toFixed(2)}</div>
              <div>Expense: INR {analysis.expense.toFixed(2)}</div>
              <div>Savings: INR {analysis.savings.toFixed(2)}</div>
              <div>GST: INR {analysis.totalGst.toFixed(2)}</div>
            </div>
          )}
        </div>

        <div className="panel chart">
          <h2>Category Spend</h2>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#127369" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="inline">
          <h2>Transactions</h2>
          <button onClick={fetchTransactions}>Refresh</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Category</th>
                <th>GST</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx._id}>
                  <td>{new Date(tx.transactionDate).toISOString().slice(0, 10)}</td>
                  <td>{tx.type}</td>
                  <td>INR {Number(tx.amount).toFixed(2)}</td>
                  <td>{tx.category}</td>
                  <td>INR {Number(tx.gstAmount || 0).toFixed(2)}</td>
                  <td>{tx.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="status">Status: {status}</footer>
    </div>
  );
}
