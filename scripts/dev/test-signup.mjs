import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function testSignup() {
  const email = `test+${Date.now()}@example.com`
  console.log('Trying to sign up:', email)
  const { data, error } = await supabase.auth.signUp({
    email,
    password: 'password123',
    options: {
      data: {
        spiritual_name: 'Test Name'
      }
    }
  })
  
  if (error) {
    console.error('Signup error:', error.message)
  } else {
    console.log('Signup success:', data.user?.id)
  }
}

testSignup()
