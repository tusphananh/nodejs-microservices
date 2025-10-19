import { useState } from "react";
import axios from "axios";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import "./App.css";

const API =
  (import.meta as any).env.VITE_API_GATEWAY || "http://localhost:5005";

type Product = { sku: string; qty: number; price: number };
type OrderRead = {
  id: string;
  items: Array<{ sku: string; qty: number; price?: number }>;
  totalPrice?: number;
  status?: string;
};

async function fetchProducts(): Promise<Product[]> {
  const r = await axios.get(`${API}/products`);
  return r.data;
}

async function fetchBalance(): Promise<{ balance: number }> {
  const r = await axios.get(`${API}/balance`);
  return r.data;
}

async function createOrder(payload: any): Promise<{ ok: boolean; id: string }> {
  const r = await axios.post(`${API}/orders`, payload);
  return r.data;
}

async function createPayment(payload: any): Promise<any> {
  const r = await axios.post(`${API}/payments`, payload);
  return r.data;
}

async function fetchOrderStatus(id: string): Promise<OrderRead> {
  // API Gateway exposes /orders/:id/status which proxies to order-service
  const r = await axios.get(`${API}/orders/${encodeURIComponent(id)}/status`);
  return r.data;
}

function App() {
  const [cartQty, setCartQty] = useState<number>(1);
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [orders, setOrders] = useState<Array<{ id: string; status?: string }>>(
    []
  );
  const queryClient = useQueryClient();

  const { data: products, isLoading: loadingProducts } = useQuery<
    Product[],
    Error
  >({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const { data: balanceData, isLoading: loadingBalance } = useQuery<
    { balance: number },
    Error
  >({
    queryKey: ["balance"],
    queryFn: fetchBalance,
    refetchInterval: 5000,
  });

  const orderMutation = useMutation<{ ok: boolean; id: string }, Error, any>({
    mutationFn: createOrder,
    onSuccess: (data) => {
      setOrders((s) => [...s, { id: data.id, status: "CREATED" }]);
    },
  });
  const {
    mutate: mutateOrder,
    status: orderStatus,
    error: orderError,
  } = orderMutation;
  const orderLoading = orderStatus === "pending";
  const orderIsError = orderStatus === "error";

  const paymentMutation = useMutation<any, Error, any>({
    mutationFn: createPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
  });
  const { mutate: mutatePayment, status: paymentStatus } = paymentMutation;
  const paymentLoading = paymentStatus === "pending";

  const checkOrder = async (orderId: string) => {
    try {
      const data = await fetchOrderStatus(orderId);
      setOrders((s) =>
        s.map((o) =>
          o.id === orderId ? { ...o, status: data.status || o.status } : o
        )
      );
    } catch (e: any) {
      alert(
        "Failed to fetch order status: " +
          (e?.response?.data?.error || e.message)
      );
    }
  };

  const handleOrder = async () => {
    if (!selectedSku) return alert("Select a product");
    const item = { sku: selectedSku, qty: Number(cartQty) };
    mutateOrder({ items: [item] });
  };

  const handlePay = async (orderId: string) => {
    try {
      mutatePayment({ orderId });
    } catch (e: any) {
      alert(
        "Could not load order to pay: " +
          (e?.response?.data?.error || e.message)
      );
    }
  };

  return (
    <div className="App">
      <h1>Microservice simulator (frontend)</h1>

      <section>
        <h3>Products</h3>
        {loadingProducts ? (
          <div>Loading products...</div>
        ) : (
          <div>
            <select
              value={selectedSku}
              onChange={(e) => setSelectedSku(e.target.value)}
            >
              <option value="">-- choose product --</option>
              {products &&
                products.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.sku} - ${p.price} (qty {p.qty})
                  </option>
                ))}
            </select>
            <input
              type="number"
              min={1}
              value={cartQty}
              onChange={(e) => setCartQty(Number(e.target.value))}
            />
            <button onClick={handleOrder} disabled={orderLoading}>
              Order
            </button>
            {orderIsError && (
              <div className="error">
                Order failed: {(orderError as Error)?.message}
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h3>Balance</h3>
        {loadingBalance ? (
          <div>Loading balance...</div>
        ) : (
          <div>Balance: ${balanceData?.balance ?? 0}</div>
        )}
        <button
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["balance"] })
          }
        >
          Refresh balance
        </button>
      </section>

      <section>
        <h3>Orders</h3>
        <div>
          {orders.length === 0 && <div>No orders yet</div>}
          {orders.map((o) => (
            <div key={o.id} className="orderRow">
              <span>ID: {o.id}</span>
              <span>Status: {o.status}</span>
              <button onClick={() => checkOrder(o.id)}>Check status</button>
              <button onClick={() => handlePay(o.id)} disabled={paymentLoading}>
                Pay
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
