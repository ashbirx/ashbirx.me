---
title: "Designing for the Day Things Break: Five Months on a Live Bike-Servicing Platform"
slug: mechiee-internship-designing-for-failure
date: 2026-10-06
author: Ashish Birajdar
description: What I learned building live tracking, optional Redis, a blog CMS and onboarding flows at Mechiee, a doorstep two-wheeler servicing startup.
tags: [internship, nodejs, react, socket-io, redis, startup, devops]
reading_time: 7 min
---

# Designing for the Day Things Break: Five Months on a Live Bike-Servicing Platform

From March to August 2026 I worked as a Full Stack Developer Intern at Mechiee, a startup that sends mechanics to your door to service your bike or scooter. I've since wrapped up the internship, and the team has told me the door is open if I want to work together again.

This post is a write-up of what I built and, more usefully, what it taught me. If I had to compress five months into one idea, it would be this: **good systems are designed around the day something stops working.**

## The platform in one paragraph

Mechiee is a Node.js/Express backend on MongoDB, with a set of React apps on top: a customer app, a mechanic app, an admin console and, later, portals for service centres. During my time the product moved from a garage-marketplace model (V1) to a service-centre model (V2), so I got to work on both the old shape and the new one. That also taught me how much of a startup's engineering is changing a running system, not just building a new one.

## 1. Live tracking that degrades gracefully

When a mechanic is on the way, the customer watches their location update on a map. The obvious way to build that is a WebSocket: the server pushes each location update, and the map moves.

The problem is that phones are on mobile networks, and mobile networks drop. If the socket quietly dies, the map freezes, and a frozen map is worse than a slow one because the customer can't tell whether the mechanic stopped or the app did.

So the tracking hook on the customer side subscribes to the socket, and while the socket is down it polls a REST endpoint every 10 seconds instead. The customer sees a map that updates a little less smoothly, not one that lies to them.

A simplified sketch of the idea:

```
if socket is connected:
    use pushed location updates
else:
    every 10 seconds: fetch the latest location over REST
```

It is a small amount of code. The point isn't cleverness. It's deciding in advance what the user should see when the fast path fails.

## 2. Making Redis optional

Redis is useful for caching, one-time passwords and rate limiting. It's also one more thing that can be unavailable: a free-tier instance that runs out of quota, a dev machine with no Redis at all, a network blip.

I worked on making Redis something the app can live without:

- It can be explicitly disabled per environment, so non-production setups don't need it.
- Reconnection uses capped backoff, so a Redis outage doesn't turn into a retry storm.
- One-time passwords are stored in Redis, with an in-memory fallback.
- The API rate limiter has an in-memory mode, and a circuit breaker so that a failing script load doesn't get retried constantly.
- A shared read-through cache helper means caching is written once, not re-invented in every module.

The rate limiter's Redis algorithms were a teammate's work. What I added was the fallback mode and the circuit breaker, so the limiter keeps limiting when Redis isn't there. That's a good example of how real work usually goes: you build on top of what someone else already made and make it more robust.

## 3. Authenticating the live part

Real-time features are easy to leave unprotected, because everything feels like it's "just a connection". I added JWT verification to the Socket.IO handshake, so an unauthenticated client can't connect at all. Before a client can join the room for a booking's tracking or chat, the server also checks that the user is actually allowed to see that booking.

A related change on the HTTP side: I moved the user's profile ID into the JWT, so booking authorization stopped needing a database lookup on every request.

## 4. A blog CMS, end to end

Mechiee needed content for SEO: a blog, categories, and city-specific landing pages. I built the blog and category system from the backend (Express, Mongoose, Zod validation, Cloudinary image uploads) through to the public blog pages and the admin editor.

It started life in a separate SEO codebase and was merged into the main platform in June. The city landing pages began as a teammate's work; I improved them with structured data and FAQ schema, added a location-loading hook with caching, integrated them, and later redesigned them. Most of the value there came from having someone else's foundation and doing the unglamorous work of making it fit.

## 5. Rebuilding the customer app

In May I rebuilt the logged-in customer app around feature modules instead of a pile of page components: a four-step booking wizard, live tracking, booking history, profile, dashboard, support chat and notifications. I applied the same structure to the admin, mechanic and garage-partner apps.

It was a big change landed quickly, and it taught me two things. A feature-based folder structure makes it far easier for several people to work in the same app without stepping on each other. And a large restructuring is only safe if you keep the behaviour the same, which is exactly where a good set of tests earns its keep. (That's one place I wish I'd written more tests myself.)

## 6. Onboarding mechanics, across four apps

One of my biggest pieces of work in the V2 period was how new mechanics join the platform. It touched four apps and the backend:

- A **four-step registration wizard** in the mechanic app (profile, specialisations, service area and schedule, then documents and bank details), with a fallback upload path if the main upload endpoint fails.
- An **admin verification desk** with an in-app document viewer, so reviewers can inspect KYC documents without opening files in new tabs, and reject individual documents with a reason.
- A **re-application flow**, so a rejected mechanic can fix specific documents and resubmit.
- A **training desk** and an **in-house onboarding wizard** in the service-centre portal.
- Backend flows and integration tests behind all of it.

It was a good lesson in how a single feature in a real product is rarely one screen. It's a pipeline that spans several roles.

## 7. Delivery: hooks, CI and deploys

I also set up much of the repository's delivery tooling: commit hooks (husky, lint-staged, commitlint for conventional commits), a GitHub Actions pipeline with a build matrix across the front-end apps, Render deploy workflows with a manually approved production release, separate dev, staging and production deploy configs, and Infisical for secrets.

One mistake is worth telling because I learned the most from it. When I rewrote the CI pipeline, I dropped the step that ran the backend tests. For about ten days, pull requests passed CI without the backend suite running. I noticed and restored it. The lesson is simple and a bit embarrassing: **a pipeline that's green is not the same as a pipeline that's checking the right things.** Now I read a CI change as carefully as a code change.

## What else was not code

A lot of the learning happened outside the editor. I did manual QA and logged bugs in a structured tracker, researched how apps like Uber, Rapido, Swiggy, Zomato, Blinkit and Urban Company handle their flows to inform our screens, and sat in meetings with the team, business consultants, accountants and investors. In a young startup nobody stays in their lane, and being in those rooms showed me why a feature gets built, not only how.

## What I'd do differently

- Write more tests alongside the features. I'm proud of the work, but I wrote fewer tests than the code deserved.
- Treat tooling changes (CI, hooks, deploys) with the same review care as product code.
- Write down decisions earlier. In a fast-moving team, the reasoning is the first thing to disappear.

## Credit where it's due

None of this was solo work. The dispatch engine, the payments integration, the inventory logic and much of the V2 backend were built by teammates, and I learned a great deal reading and working alongside their code. I'm grateful to the whole Mechiee team for the trust, and for letting a student work on a live product.

## What's next

I've wrapped up the internship, and I'm looking forward to building again.

If you're a student wondering whether to take on a real startup internship: do it, but go in expecting to learn about systems that fail, teams that change direction, and the unglamorous work that keeps a product running. That turned out to be the best part.
