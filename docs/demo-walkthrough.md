# Demo walkthrough

A guided tour of the shopper experience after you deploy StoreAI and sign in. See
[getting-started.md](getting-started.md) to deploy and obtain your store URL and credentials. Each
step below describes what you see on screen and a sample interaction; your exact wording and results
will vary with the catalog and the chat model in use.

## 1. Sign in

Open the store URL printed by `deploy/storeai up`. You land on a Cognito-hosted sign-in page.

- **On screen:** email and password fields.
- **Do this:** sign in with the admin user created during deployment. If you configured a real
  `adminEmail`, use the temporary password from the Cognito invitation email (you'll set your own on
  first sign-in); otherwise sign in as `admin@storeai.local` with the password you set via the CLI
  command the deployer printed.
- **Result:** the storefront loads — a product grid on the left/center and the assistant panel on the
  right, with the cost sidebar visible.

## 2. Browse the catalog

Before chatting, you can browse the seeded catalog directly.

- **On screen:** a grid of product cards (image, name, price, category). Selecting a card opens a
  product detail view with sizes, description, and **Try on** and **Add to cart** actions.
- **Result:** opening a product also gives the assistant context, so you can ask about the item you
  are viewing.

## 3. Chat with the assistant

Type a natural request in the assistant panel.

- **You say:** "I'm looking for a casual shirt for the weekend, under $50."
- **Assistant does:** calls the catalog tools and returns a short recommendation with 2–4 product
  cards rendered inline in the chat.
- **You say:** "What goes well with the second one?"
- **Assistant does:** recommends complementary items from related categories and explains why.
- **On screen:** each assistant reply shows its estimated AI cost, and the sidebar total ticks up (see
  the cost model in [architecture.md](architecture.md#cost-model)).

## 4. Talk to the assistant (voice)

Use the microphone control to speak instead of type.

- **On screen:** a mic/recording indicator and a label showing the active speech engine.
- **You say (spoken):** "Show me something warmer for winter."
- **Assistant does:** transcribes your speech (Amazon Nova Sonic, or Whisper if that module is
  deployed), answers as in text chat, and speaks the reply back with Nova Sonic text-to-speech.
- **Result:** the conversation continues seamlessly between voice and text.

## 5. Get a size recommendation

Ask the assistant which size to pick.

- **You say:** "What size should I get in this shirt? I'm usually a medium but between sizes."
- **Assistant does:** calls the size-recommendation tool (optionally using your uploaded photo) and
  returns a suggested size with a short rationale.
- **On screen:** the recommended size is highlighted on the product's size selector.

## 6. Virtual try-on

See yourself wearing a garment.

1. Open a product and choose **Try on**.
2. **On screen:** a prompt to take or upload a photo of yourself.
3. **Do this:** upload a clear, front-facing photo.
4. **Assistant does:** generates an image of you wearing the garment (FASHN by default, or Qwen
   Image-Edit if that engine is deployed). Generation typically takes ~15–40s.
5. **Result:** the generated image appears in the chat and in your **try-on room** (a shortlist of
   items you have tried on). The reply shows the try-on cost and the engine used.

If a generated image does not pass the content-safety check, you see a short "couldn't complete this
try-on" message instead — try a different product or photo. (See the fails-open note in
[security.md](security.md).)

## 7. Cart and checkout

Add items and place a demo order.

- **You say:** "Add the blue shirt in medium to my cart." — or use **Add to cart** on the product.
- **Assistant does:** updates the cart and confirms the item and size.
- **Do this:** open the cart and choose **Checkout**.
- **On screen:** checkout is a demo flow (no real payment). On completion, a **QR code** is shown that
  links to a shareable gallery of your try-on results, and the order appears in your order history.

## 8. Watch the cost sidebar

Throughout the session, the sidebar breaks down estimated AI cost by category.

- **On screen:** running totals for chat (LLM), try-on, and speech-to-text, each labeled with the
  model or engine, plus a separate, clearly labeled **infrastructure estimate**.
- **Note:** this is an estimate of AI-inference cost, not your AWS bill. It resets when you sign out.

## Booth mode

Setting `cdn.demoMode` to `booth` (see [configuration.md](configuration.md)) switches the UI into a
kiosk layout with stations (shopping, try-on) suited to staffed in-person events.

- **On screen:** simplified, station-oriented screens instead of the single scrolling page.
- **`standard` mode** is the normal single-page web experience described above.
