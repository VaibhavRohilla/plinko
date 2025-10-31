import { useEffect, useRef, useState, memo } from "react";
import { BallManager } from "../game/classes/BallManager";

// Type definitions
type GameMode = "manual" | "auto";

// Mock data - will be replaced with real state management later
const MOCK_USER = {
  balance: 1000.0,
  currency: "USD",
};

// Component Props Types
type HeaderProps = {
  balance: number;
  currency: string;
};

type SidebarProps = {
  mode: GameMode;
  setMode: (mode: GameMode) => void;
  placeBet: () => void;
};

type FooterProps = {
  className?: string;
};

// Memoized Header component
const Header = memo(({ balance, currency }: HeaderProps) => (
  <header className="w-full bg-gray-900/60 backdrop-blur-md border-b border-gray-800 p-4">
    <div className="max-w-7xl mx-auto flex justify-between items-center">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
        Plinko
      </h1>
      <div className="flex items-center space-x-6">
        <div className="flex items-center bg-gray-800/50 rounded-lg px-4 py-2">
          <span className="text-gray-400 mr-2">Balance:</span>
          <span className="text-green-400 font-mono">
            {currency}${balance}
          </span>
        </div>
        <button
          type="button"
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          aria-label="Settings"
        >
          FiSettings{" "}
        </button>
      </div>
    </div>
  </header>
));

// Memoized Sidebar component
const ManualControls = memo(() => {
  const totalBalance = 115; // example - replace with your real balance
  const maxBetLimit = 20;

  const [amount, setAmount] = useState<string>(""); // empty by default
  const [error, setError] = useState<string>("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Allow empty value (when user clears input)
    if (value === "") {
      setAmount("");
      setError("");
      return;
    }

    const numericValue = parseFloat(value);

    // Disallow non-numeric or negative
    if (isNaN(numericValue) || numericValue < 0) {
      setError("Please enter a valid number.");
      return;
    }

    // Validation against balance and max
    if (numericValue > totalBalance) {
      setError("Insufficient balance.");
      // setAmount(totalBalance.toString());
    } else if (numericValue > maxBetLimit) {
      setError(`Bet amount cannot exceed ${maxBetLimit}.`);
      // setAmount(maxBetLimit.toString());
    } else {
      setError("");
    }
    setAmount(value);
  };

  const handleHalf = () => {
    const numeric = parseFloat(amount || "0");
    const newAmount = Math.max(numeric / 2, 0);
    setAmount(newAmount ? newAmount.toString() : "");
    setError("");
  };

  const handleDouble = () => {
    const numeric = parseFloat(amount || "0");
    const doubled = numeric >= 10 ? 20 : numeric * 2;
    const newAmount = Math.min(doubled, totalBalance, maxBetLimit);
    setAmount(newAmount ? newAmount.toString() : "");
    setError("");
  };

  const [ballCount, setBallCount] = useState<number>(8);

  const handleChangeBallAmount = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const numericValue = parseInt(value, 10);

    // Allow empty temporarily
    if (value === "") {
      setBallCount(8);
      return;
    }

    if (isNaN(numericValue)) {
      return;
    }

    if (numericValue < 8) {
      setBallCount(8);
    } else if (numericValue > 16) {
      setBallCount(16);
    } else {
      setBallCount(numericValue);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="betAmount" className="block text-gray-400 mb-2 text-sm">
          Bet Amount
        </label>

        <div className="flex items-center gap-2">
          <input
            id="betAmount"
            type="number"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
            placeholder="0.00"
            min="0"
            step="0.1"
            max={maxBetLimit}
            value={amount}
            onChange={handleChange}
          />
          <button
            type="button"
            onClick={handleHalf}
            className="bg-gray-700 text-white px-3 py-1 rounded hover:bg-gray-600"
          >
            1/2x
          </button>
          <button
            type="button"
            onClick={handleDouble}
            className="bg-gray-700 text-white px-3 py-1 rounded hover:bg-gray-600"
          >
            2x
          </button>
        </div>

        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

        <p className="text-gray-400 text-xs mt-1">
          Balance: <span className="text-white">{totalBalance}</span>
        </p>
      </div>
      <div>
        <label htmlFor="riskLevel" className="block text-gray-400 mb-2 text-sm">
          Risk Level
        </label>
        <select
          id="riskLevel"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div>
        <label htmlFor="ballCount" className="block text-gray-400 mb-2 text-sm">
          Number of Balls
        </label>

        <input
          id="ballCount"
          type="number"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          placeholder="1"
          min="1"
          max="16"
          value={ballCount}
          onChange={handleChangeBallAmount}
        />
      </div>
    </div>
  );
});

const AutoControls = memo(() => {
  const [roundCount, setRoundCount] = useState<number | "">("");
  const [error, setError] = useState<string>("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Allow empty temporarily
    if (value === "") {
      setRoundCount("");
      setError("");
      return;
    }

    const numericValue = parseInt(value, 10);

    // Block non-numeric input
    if (isNaN(numericValue)) {
      setError("Please enter a valid number.");
      return;
    }

    if (numericValue < 1) {
      setError("Minimum number of bets is 1.");
      setRoundCount(1);
    } else {
      setRoundCount(numericValue);
      setError("");
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div>
        <label
          htmlFor="roundCount"
          className="block text-gray-400 mb-2 text-sm"
        >
          Number of Bets
        </label>
        <input
          id="roundCount"
          type="number"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          placeholder="0"
          min="1"
          value={roundCount}
          onChange={handleChange}
        />
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>
    </div>
  );
});

const Sidebar = memo(({ mode, setMode, placeBet }: SidebarProps) => (
  <aside className="w-full lg:w-80 bg-gray-900/60 backdrop-blur-md border-r border-gray-800 p-4">
    <div className="flex mb-6">
      <button
        type="button"
        onClick={() => setMode("manual")}
        className={`flex-1 py-2 text-center ${
          mode === "manual"
            ? "bg-purple-600 text-white"
            : "bg-gray-800 text-gray-400"
        } rounded-l-lg transition-colors`}
      >
        Manual
      </button>
      <button
        type="button"
        onClick={() => setMode("auto")}
        className={`flex-1 py-2 text-center ${
          mode === "auto"
            ? "bg-purple-600 text-white"
            : "bg-gray-800 text-gray-400"
        } rounded-r-lg transition-colors`}
      >
        Auto
      </button>
    </div>
    <ManualControls />
    {mode === "auto" ? <AutoControls /> : ""}
    <button
      type="button"
      className="mt-6 px-12 py-3 w-full bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-semibold shadow-lg hover:shadow-purple-500/25 transition hover:scale-105"
      onClick={placeBet}
    >
      Place Bet
    </button>
  </aside>
));

// Memoized Footer component
const Footer = memo(({ className = "" }: FooterProps) => (
  <footer
    className={`w-full bg-gray-900/60 backdrop-blur-md border-t border-gray-800 p-4 ${className}`}
  >
    <div className="max-w-7xl mx-auto flex justify-between items-center text-sm">
      <div className="flex items-center space-x-4">
        <button
          type="button"
          className="text-gray-400 hover:text-white flex items-center"
        >
          FiInfo Fair Play
        </button>
        <button
          type="button"
          className="text-gray-400 hover:text-white flex items-center"
        >
          FiHelpCircle Support
        </button>
      </div>
      <div className="text-gray-500">© 2025 Plinko Game</div>
    </div>
  </footer>
));

export function Game() {
  const [ballManager, setBallManager] = useState<BallManager>();
  const [mode, setMode] = useState<GameMode>("manual");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      const ballManager = new BallManager(canvasRef.current);
      setBallManager(ballManager);
    }
  }, [canvasRef]);

  const placeBet = () => {
    ballManager?.addBall(3972887.657476276);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <Header balance={MOCK_USER.balance} currency={MOCK_USER.currency} />

      <div className="flex-1 flex flex-col lg:flex-row">
        <Sidebar mode={mode} setMode={setMode} placeBet={placeBet} />

        <main className="flex-1 p-4 flex flex-col items-center justify-center">
          <div className="relative w-full max-w-3xl aspect-square">
            <canvas
              ref={canvasRef}
              width="800"
              height="800"
              className="w-full h-full"
            />
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
}
