import "./App.css";
import { Home } from "./pages/Home";
import { Calibrate } from "./pages/Calibrate";

function App() {
  const isCalibrate =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("mode") === "calibrate";
  return isCalibrate ? <Calibrate /> : <Home />;
}

export default App;
