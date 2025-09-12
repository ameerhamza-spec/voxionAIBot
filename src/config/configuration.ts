export default () => ({
  port: process.env.PORT || 3002,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },
  server: {
    baseUrl: process.env.SERVER_BASE_URL,
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  },
});