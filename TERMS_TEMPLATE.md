# Inverse Claw Index — Terms of Service Template

**Note to Claude Code:** Do not build these into the application. 
These are for the human to review with a solicitor and publish as a 
static page. Include a link to this URL in the registration flow.

---

## Inverse Claw Index — Provider Terms of Service

*Last updated: [DATE]*

### 1. What Inverse Claw Index Is

Inverse Claw Index ("the Index") is a self-registration directory that allows 
businesses ("Providers") to list their machine-readable service capabilities so 
that AI agents can discover and connect with them.

The Index is operated by [YOUR COMPANY NAME] ("we", "us", "our").

### 2. What We Are Not

**We are not a marketplace.** We do not facilitate, broker, or intermediate 
transactions between Providers and their customers.

**We are not a payment processor.** Payments flow directly between customers 
and Providers via Stripe. We do not hold, handle, or process any funds.

**We do not verify Providers.** Listing on the Index does not constitute 
endorsement, verification, or approval by us. We verify only that a Provider 
controls a domain or social media presence where their node ID appears.

**We are not a party to any transaction.** Contracts for services are formed 
directly between the Provider and the customer. We have no involvement in 
service delivery, quality, or disputes.

### 3. Provider Responsibilities

By registering on the Index, you confirm that:

a) You are authorised to register the business you are listing  
b) All information you provide is accurate and will be kept up to date  
c) You hold any licences, insurance, or registrations required to provide 
   the services you list  
d) You will honour transactions initiated through your Inverse Claw node  
e) You will maintain the contact details in your listing so customers can 
   reach you for disputes  
f) Your use of the Index will comply with all applicable laws  

### 4. Our Rights

We reserve the right to:

a) Remove any listing at any time for any reason without notice  
b) Suspend or terminate access to the Index for any Provider  
c) Modify these terms at any time (continued use constitutes acceptance)  

### 5. Liability

**We accept no liability for:**
- The quality, safety, or legality of any service listed on the Index
- Any transaction between a Provider and a customer
- Any loss arising from use of, or inability to use, the Index
- Accuracy of information submitted by Providers

Our total liability to you in connection with the Index shall not exceed 
the fees paid by you to us in the 12 months preceding the claim.

### 6. Data and Privacy

We process personal data (contact email, phone number) under UK GDPR on 
the lawful basis of consent given at registration.

You may request removal of your data at any time by calling 
DELETE /nodes/[your_node_id] with your API key. We will anonymise your 
personal data within 30 days, though your node_id and transaction history 
may be retained for audit purposes.

See our Privacy Notice at [URL] for full details.

### 7. Governing Law

These terms are governed by the laws of England and Wales.

---

**Note for implementation:**

In the registration API, store:
- `terms_accepted: true` (boolean, must be true to register)
- `terms_accepted_at` (timestamp)
- `terms_accepted_ip` (IP address of registration request)

This creates the audit trail showing the Provider accepted terms.

The registration flow should display a checkbox:
"I have read and accept the Inverse Claw Index Terms of Service and confirm 
I am authorised to register this business."

Registration must be rejected if terms_accepted is not true.
