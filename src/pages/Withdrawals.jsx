import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import request from "../utils/api";
import "../styles/withdrawals.css";

const money = (value) => `₦${Number(value || 0).toLocaleString()}`;

function Withdrawals() {
  const { user, refreshUser } = useAuth();

  const [data, setData] = useState({
    savingsBalance: 0,
    lockedAmount: 0,
    availableAmount: 0,
    reservedAmount: 0,
    loanFundsBalance: 0,
    withdrawals: [],
  });

  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState("");
  const [bankSearch, setBankSearch] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const bankSelectorRef = useRef(null);

  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [amount, setAmount] = useState("");

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [pinLoading, setPinLoading] = useState(true);
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMessage, setPinMessage] = useState("");

  const [loading, setLoading] = useState(true);
  const [banksLoading, setBanksLoading] = useState(true);
  const [verifyingAccount, setVerifyingAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [accountError, setAccountError] = useState("");

  const selectedBank = useMemo(
    () => banks.find((bank) => bank.code === bankCode),
    [banks, bankCode],
  );

  const filteredBanks = useMemo(() => {
    const search = bankSearch.trim().toLowerCase();
    if (!search) return banks;

    return banks.filter((bank) => bank.name.toLowerCase().includes(search));
  }, [banks, bankSearch]);

  const loadWithdrawals = useCallback(async () => {
    if (!user?.token) return;

    try {
      setLoading(true);
      const result = await request("/withdrawals/me", {
        token: user.token,
      });
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.token]);

  const loadBanks = useCallback(async () => {
    if (!user?.token) return;

    try {
      setBanksLoading(true);
      const result = await request("/withdrawals/banks", {
        token: user.token,
      });
      setBanks(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBanksLoading(false);
    }
  }, [user?.token]);

  const loadPinStatus = useCallback(async () => {
    if (!user?.token) return;

    try {
      setPinLoading(true);
      const result = await request("/withdrawals/pin/status", {
        token: user.token,
      });
      setHasPin(Boolean(result.hasWithdrawalPin));
    } catch (err) {
      setError(err.message);
    } finally {
      setPinLoading(false);
    }
  }, [user?.token]);

  useEffect(() => {
    loadWithdrawals();
    loadBanks();
    loadPinStatus();
  }, [loadWithdrawals, loadBanks, loadPinStatus]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        bankSelectorRef.current &&
        !bankSelectorRef.current.contains(event.target)
      ) {
        setBankOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const createPin = async () => {
    setPinMessage("");

    if (!/^\d{4}$/.test(pin)) {
      setPinMessage("PIN must be exactly 4 digits.");
      return;
    }

    if (pin !== confirmPin) {
      setPinMessage("PINs do not match.");
      return;
    }

    try {
      setPinSaving(true);

      const result = await request("/withdrawals/pin", {
        method: "POST",
        token: user.token,
        body: { pin, confirmPin },
      });

      setHasPin(true);
      setPin("");
      setConfirmPin("");
      setPinMessage(result.message || "Withdrawal PIN created successfully.");
    } catch (err) {
      setPinMessage(err.message);
    } finally {
      setPinSaving(false);
    }
  };
  const verifyAccount = async () => {
    setAccountError("");
    setAccountName("");

    if (!bankCode) {
      setAccountError("Select your bank first.");
      return;
    }

    if (!/^\d{10}$/.test(accountNumber)) {
      setAccountError("Enter a valid 10-digit account number.");
      return;
    }

    try {
      setVerifyingAccount(true);

      const result = await request("/withdrawals/verify-account", {
        method: "POST",
        token: user.token,
        body: { accountNumber, bankCode },
      });

      setAccountName(result.accountName || "");
    } catch (err) {
      setAccountError(err.message);
    } finally {
      setVerifyingAccount(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a valid withdrawal amount.");
      return;
    }

    if (value > Number(data.availableAmount || 0)) {
      setError(`You can withdraw up to ${money(data.availableAmount)}.`);
      return;
    }

    if (!accountName) {
      setError("Verify your bank account before continuing.");
      return;
    }

    if (!hasPin) {
      setError("Create your withdrawal PIN before making a withdrawal.");
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      setError("Enter your 4-digit withdrawal PIN.");
      return;
    }

    const confirmed = window.confirm(
      `Confirm withdrawal of ${money(value)} to ${accountName} at ${
        selectedBank?.name || "your bank"
      }, account ending ${accountNumber.slice(-4)}?`,
    );

    if (!confirmed) return;

    try {
      setSubmitting(true);

      const result = await request("/withdrawals", {
        method: "POST",
        token: user.token,
        body: {
          amount: value,
          pin,
          bankCode,
          bankName: selectedBank?.name || "",
          accountNumber,
          accountName,
        },
      });

      setSuccess(result.message || "Withdrawal submitted successfully.");
      setAmount("");
      setPin("");

      await Promise.all([loadWithdrawals(), refreshUser()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (status) => {
    if (status === "processing") return "Processing";
    if (status === "success") return "Paid";
    if (status === "reversed") return "Reversed";
    if (status === "rejected") return "Rejected";
    return "Failed";
  };

  return (
    <main className="withdrawals-page">
      <div className="withdrawals-heading">
        <div>
          <p className="eyebrow">Savings</p>
          <h1>Withdrawals</h1>
          <p>
            Withdraw from your savings while keeping the cooperative's 20%
            savings reserve in place.
          </p>
        </div>
      </div>

      {error && <div className="withdrawal-alert error">{error}</div>}
      {success && <div className="withdrawal-alert success">{success}</div>}

      <section className="withdrawal-balance-grid">
        <div className="withdrawal-balance-card">
          <span>Current Savings</span>
          <strong>{loading ? "Loading..." : money(data.savingsBalance)}</strong>
        </div>

        <div className="withdrawal-balance-card locked">
          <span>50% Locked Reserve</span>
          <strong>{loading ? "Loading..." : money(data.lockedAmount)}</strong>
        </div>

        <div className="withdrawal-balance-card">
          <span>Loan Funds Included</span>
          <strong>
            {loading ? "Loading..." : money(data.loanFundsBalance)}
          </strong>
        </div>

        <div className="withdrawal-balance-card available">
          <span>Available to Withdraw</span>
          <strong>
            {loading ? "Loading..." : money(data.availableAmount)}
          </strong>
        </div>
      </section>

      <section className="withdrawal-card">
        <div className="withdrawal-card-header">
          <div>
            <p className="eyebrow">Bank Transfer</p>
            <h2>Request a Withdrawal</h2>
          </div>
        </div>

        <div className="withdrawal-rule">
          <strong>50% savings reserve</strong>
          <span>
            You can withdraw up to 50% of your current savings. An outstanding
            loan does not create an additional 20% lock.
          </span>
        </div>

        <form className="withdrawal-form" onSubmit={handleSubmit}>
          <label>
            Withdrawal Amount (₦)
            <input
              type="number"
              min="1"
              step="0.01"
              max={data.availableAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 250000"
              disabled={submitting}
            />
          </label>

          <label className="bank-selector-label">
            Bank
            <div
              className={`bank-selector ${bankOpen ? "open" : ""}`}
              ref={bankSelectorRef}
            >
              <button
                type="button"
                className="bank-selector-trigger"
                onClick={() => {
                  if (!banksLoading && !submitting) {
                    setBankOpen((prev) => !prev);
                  }
                }}
                disabled={banksLoading || submitting}
              >
                <span
                  className={
                    selectedBank ? "selected-bank-name" : "placeholder"
                  }
                >
                  {banksLoading
                    ? "Loading banks..."
                    : selectedBank?.name || "Select your bank"}
                </span>

                <span className="bank-chevron">{bankOpen ? "⌃" : "⌄"}</span>
              </button>

              {bankOpen && !banksLoading && (
                <div className="bank-dropdown">
                  <div className="bank-search-wrap">
                    <input
                      type="text"
                      className="bank-search-input"
                      placeholder="Search bank..."
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>

                  <div className="bank-options">
                    {filteredBanks.length === 0 ? (
                      <div className="bank-no-results">No bank found</div>
                    ) : (
                      filteredBanks.map((bank) => (
                        <button
                          type="button"
                          key={bank.code}
                          className={`bank-option ${
                            bank.code === bankCode ? "selected" : ""
                          }`}
                          onClick={() => {
                            setBankCode(bank.code);
                            setAccountName("");
                            setAccountError("");
                            setBankSearch("");
                            setBankOpen(false);
                          }}
                        >
                          <span>{bank.name}</span>
                          {bank.code === bankCode && (
                            <span className="bank-check">✓</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </label>

          <label>
            Account Number
            <div className="account-verify-row">
              <input
                type="text"
                inputMode="numeric"
                maxLength="10"
                value={accountNumber}
                onChange={(e) => {
                  setAccountNumber(e.target.value.replace(/\D/g, ""));
                  setAccountName("");
                  setAccountError("");
                }}
                placeholder="10-digit account number"
                disabled={submitting}
              />

              <button
                type="button"
                className="verify-account-btn"
                onClick={verifyAccount}
                disabled={verifyingAccount || submitting}
              >
                {verifyingAccount ? "Checking..." : "Verify"}
              </button>
            </div>
          </label>

          {accountError && <p className="form-error">{accountError}</p>}

          {accountName && (
            <div className="verified-account">
              <span>Verified account name</span>
              <strong>{accountName}</strong>
            </div>
          )}

          {pinLoading ? (
            <div className="withdrawal-rule">
              <strong>Withdrawal security</strong>
              <span>Checking your withdrawal PIN status...</span>
            </div>
          ) : !hasPin ? (
            <div className="withdrawal-pin-box">
              <p className="eyebrow">Security</p>
              <h3>Create your 4-digit Withdrawal PIN</h3>
              <p>
                This PIN is separate from your login password and is used only
                to authorize withdrawals.
              </p>

              <div className="withdrawal-pin-form">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength="4"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="4-digit PIN"
                  disabled={pinSaving || submitting}
                />

                <input
                  type="password"
                  inputMode="numeric"
                  maxLength="4"
                  autoComplete="off"
                  value={confirmPin}
                  onChange={(e) =>
                    setConfirmPin(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="Confirm PIN"
                  disabled={pinSaving || submitting}
                />

                <button
                  type="button"
                  className="verify-account-btn"
                  onClick={createPin}
                  disabled={pinSaving || submitting}
                >
                  {pinSaving ? "Creating..." : "Create PIN"}
                </button>
              </div>

              {pinMessage && (
                <p
                  className={
                    pinMessage.toLowerCase().includes("success")
                      ? "form-success"
                      : "form-error"
                  }
                >
                  {pinMessage}
                </p>
              )}
            </div>
          ) : (
            <>
              <label>
                4-Digit Withdrawal PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength="4"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter your withdrawal PIN"
                  disabled={submitting}
                />
                <small>
                  Your withdrawal PIN is securely verified on the server and is
                  never shown to administrators.
                </small>
              </label>
            </>
          )}

          <button
            type="submit"
            className="withdraw-submit-btn"
            disabled={submitting || loading || data.availableAmount <= 0}
          >
            {submitting ? "Processing Withdrawal..." : "Confirm Withdrawal"}
          </button>
        </form>
      </section>

      <section className="withdrawal-card">
        <div className="withdrawal-card-header history-header">
          <div>
            <p className="eyebrow">History</p>
            <h2>Your Withdrawals</h2>
          </div>

          <button
            type="button"
            className="withdraw-refresh-btn"
            onClick={loadWithdrawals}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {(data.withdrawals || []).length === 0 ? (
          <p className="withdrawal-empty">No withdrawal requests yet.</p>
        ) : (
          <div className="withdrawal-history-wrap">
            <table className="withdrawal-history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bank</th>
                  <th>Account</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {(data.withdrawals || []).map((withdrawal) => (
                  <tr key={withdrawal._id}>
                    <td>
                      {withdrawal.createdAt
                        ? new Date(withdrawal.createdAt).toLocaleDateString()
                        : "—"}
                    </td>

                    <td>{withdrawal.bankName}</td>

                    <td>
                      {withdrawal.accountName} ····
                      {withdrawal.accountNumberLast4}
                    </td>

                    <td className="withdrawal-amount">
                      {money(withdrawal.amount)}
                    </td>

                    <td>
                      <span className={`status-badge ${withdrawal.status}`}>
                        {statusLabel(withdrawal.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default Withdrawals;
