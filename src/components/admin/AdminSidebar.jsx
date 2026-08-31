import {
  FaThLarge,
  FaUsers,
  FaIdCard,
  FaWallet,
  FaHandHoldingUsd,
  FaFileInvoiceDollar,
  FaMoneyBillWave,
  FaCoins,
  FaExchangeAlt,
  FaMoneyCheckAlt,
  FaChartBar,
  FaCog,
  FaImages,
  FaSignOutAlt,
} from "react-icons/fa";

import logo from "../../assets/logo.png";

const menuItems = [
  {
    id: "overview",
    label: "Overview",
    icon: FaThLarge,
  },
  {
    id: "members",
    label: "Members",
    icon: FaUsers,
  },
  {
    id: "membership",
    label: "Membership Applications",
    icon: FaIdCard,
  },
  {
    id: "savings",
    label: "Savings & Deposits",
    icon: FaWallet,
  },
  {
    id: "loans",
    label: "Loans",
    icon: FaHandHoldingUsd,
  },
  {
    id: "loan-eligibility",
    label: "Full Loan Applications",
    icon: FaIdCard,
  },
  {
    id: "loan-requests",
    label: "Loan Requests",
    icon: FaFileInvoiceDollar,
  },
  {
    id: "repayments",
    label: "Repayments",
    icon: FaMoneyBillWave,
  },
  {
    id: "dividends",
    label: "Dividends",
    icon: FaCoins,
  },
  {
    id: "transactions",
    label: "Transactions",
    icon: FaExchangeAlt,
  },
  {
    id: "withdrawals",
    label: "Withdrawals",
    icon: FaMoneyCheckAlt,
  },
  {
    id: "reports",
    label: "Reports",
    icon: FaChartBar,
  },
  {
    id: "gallery",
    label: "Gallery",
    icon: FaImages,
  },
  {
    id: "settings",
    label: "Settings",
    icon: FaCog,
  },
];

function AdminSidebar({ activeSection, onNavigate, onLogout }) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <img src={logo} alt="Exclusive Cooperative" />
        <div className="admin-brand-text">
          <strong>Exclusive</strong>
          <span>Cooperative</span>
        </div>
      </div>

      <nav className="admin-navigation">
        <p className="admin-nav-label">MAIN MENU</p>

        {menuItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              className={`admin-nav-item ${
                activeSection === item.id ? "active" : ""
              }`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="admin-nav-icon" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="admin-sidebar-bottom">
        <button
          type="button"
          className="admin-nav-item logout-item"
          onClick={onLogout}
        >
          <FaSignOutAlt className="admin-nav-icon" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

export default AdminSidebar;
