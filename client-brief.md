# Client Brief – Stranger Text Chat Web App

## Project Overview
We want to build a modern stranger text chat web application similar to Chitchat.gg, but with a more seamless, modern, and user-friendly experience.

The platform should allow users to connect instantly with random strangers through text chat while introducing better UX, smoother media sharing, and enhanced premium-style features.

The goal is to create a fast, engaging, and scalable web app focused on anonymous social interaction and real-time communication.

---

# Main Objectives

- Create a real-time stranger text chat platform
- Improve the overall experience compared to Chitchat.gg
- Introduce a more practical and seamless media-sharing system inspired by Snapchat
- Make the platform modern, smooth, and mobile-friendly
- Allow users to log in with Google
- Provide premium features to logged-in users initially

---

# Core Features

## 1. Random Stranger Text Chat
- Instant random user matching
- One-to-one text chat
- Fast reconnect / next user functionality
- Typing indicators
- Online user status
- Smooth chat transitions

---

## 2. User Authentication

Users should have two modes:

### Guest Users
- Can instantly start chatting
- Limited features

### Logged-in Users

Login via:
- Google Authentication

Benefits for logged-in users:
- Access to premium features
- Better matching experience
- Media sharing access

---

# Premium Features (Initially Free for Logged-in Users)

Although these are premium-style features, they will be unlocked for all users who log in using Google during the initial launch phase.

Features include:

## Gender Filters

Users can choose:
- Male
- Female
- Both

This feature should improve match relevance.

---

## Media Sharing (Major Focus)

Current media sharing on Chitchat.gg feels impractical for a web app.

We want to create a much smoother and more seamless experience inspired by Snapchat.

### Expected Experience
- Instant media sending inside chat
- Images should load quickly
- Smooth preview experience
- Temporary/disappearing media support
- View-once media option
- Screenshot detection/notification (future-ready architecture)
- Mobile-friendly media interaction
- Minimal friction while sharing

### Goal
Make media sharing feel natural and modern even on a web application.

---

# UI/UX Expectations

The platform should feel:
- Minimal
- Fast
- Modern
- Clean
- Addictive and engaging

Important UX priorities:
- Smooth transitions
- Low latency feeling
- Responsive on mobile and desktop
- Real-time updates without reloads
- Modern animations and interactions

---

# Suggested Additional Features

These are optional but recommended:

- Interest-based matching
- Chat reporting system
- User blocking
- Auto moderation / spam protection
- Chat reconnect history
- Dark mode
- Push notifications
- Sound effects for matching/messages
- AI moderation for unsafe content

---

# Technical Expectations

## Platform Type
- Web Application

## Recommended Tech Stack

### Frontend
- Next.js
- React
- Tailwind CSS

### Backend
- Node.js
- Express.js / NestJS

### Real-time Communication
- WebSockets / Socket.IO

### Authentication
- Google OAuth

### Database
- PostgreSQL

### Caching / Matchmaking
- Redis

### Media Storage
- AWS S3 / Cloudinary

---

# Key Differentiators vs Chitchat.gg

| Chitchat.gg | Our Platform |
|---|---|
| Basic media sharing | Snapchat-like seamless media experience |
| Limited UX polish | Smooth modern UX |
| Premium locked features | Premium access for logged-in users initially |
| Standard stranger chat | Better matching + scalable architecture |
| Generic experience | More engaging and mobile-friendly |

---

# Future Scope

Potential future upgrades:
- Voice chat
- Video chat
- AI-powered matchmaking
- Region/language filters
- Subscription plans
- Mobile apps (iOS & Android)
- Creator/community system
- Gamification and streaks

---

# Final Goal

Build a modern, scalable, and highly engaging stranger chat platform that improves the weaknesses of existing platforms like Chitchat.gg while offering a smoother communication and media-sharing experience optimized for web users.