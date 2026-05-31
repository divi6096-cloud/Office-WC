import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Public   from './pages/Public'
import Admin    from './pages/Admin'
import PickPage from './pages/PickPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"      element={<Public />}   />
        <Route path="/admin" element={<Admin />}    />
        <Route path="/picks" element={<PickPage />} />
      </Routes>
    </BrowserRouter>
  )
}
