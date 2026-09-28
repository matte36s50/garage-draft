import { render, screen } from '@testing-library/react'
import App from './App'

// The app creates its Supabase client at import time. Stand in for it with a
// signed-out session and empty query results, so the test never hits the network.
jest.mock('@supabase/supabase-js', () => {
  const empty = { data: [], error: null, count: 0 }
  const query = new Proxy({}, {
    get: (_, prop) => (prop === 'then' ? resolve => resolve(empty) : () => query),
  })
  return {
    createClient: () => ({
      from: () => query,
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: () => {},
      auth: {
        onAuthStateChange: callback => {
          callback('INITIAL_SESSION', null)
          return { data: { subscription: { unsubscribe() {} } } }
        },
        signOut: () => Promise.resolve({ error: null }),
      },
    }),
  }
})

test('a signed-out visitor gets the landing page', async () => {
  render(<App />)
  expect(await screen.findByText(/RACE THE/)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /SIGN IN/ }).length).toBeGreaterThan(0)
})
