import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

function App() {
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    loadParticipants();
  }, []);

  async function loadParticipants() {
    const { data, error } = await supabase
      .from("participants")
      .select("*");

    if (!error) {
      setParticipants(data);
    }
  }

  return (
    <div style={{ padding: "20px" }}>
      <h1>World Cup Sweepstake</h1>

      <h2>Participants</h2>

      <table border="1" cellPadding="10">
        <thead>
          <tr>
            <th>Name</th>
            <th>Paid</th>
          </tr>
        </thead>

        <tbody>
          {participants.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.paid ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;