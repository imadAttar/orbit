import ReactDOM from "react-dom/client";
import App from "./App";
import AppI18nWrapper from "./AppI18nWrapper";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppI18nWrapper>
    <App />
  </AppI18nWrapper>
);
