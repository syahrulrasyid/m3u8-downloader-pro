# Overview

This is a video download manager application that specializes in downloading M3U8 playlist-based video content. The application provides a web-based interface for detecting M3U8 URLs from web pages, managing download queues, and monitoring download progress in real-time. It features a modern React frontend with a Node.js/Express backend that handles video segmentation, multi-threaded downloading, and WebSocket-based progress updates.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Library**: Shadcn/UI components built on top of Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming support
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Real-time Updates**: Custom WebSocket hook for live download progress

## Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Design**: RESTful APIs with WebSocket support for real-time communication
- **Download Engine**: Custom multi-threaded download system using Worker threads
- **M3U8 Processing**: Built-in parser for detecting and processing M3U8 playlists
- **Session Management**: Express sessions with PostgreSQL store

## Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Database Provider**: Neon serverless PostgreSQL
- **Schema Management**: Drizzle Kit for migrations and schema management
- **Temporary Storage**: In-memory storage implementation for development/testing
- **File System**: Local file system for downloaded video content

## Authentication and Authorization
- **Session Management**: Express sessions stored in PostgreSQL
- **Security**: CORS enabled, JSON body parsing, URL encoding support
- **Development Security**: Runtime error overlay and development banners in non-production

## External Dependencies
- **Database**: Neon serverless PostgreSQL for production data storage
- **UI Components**: Radix UI for accessible component primitives
- **HTTP Client**: Axios for external API requests and video segment downloading
- **WebSocket**: Native WebSocket implementation for real-time progress updates
- **Form Handling**: React Hook Form with Zod validation for type-safe forms
- **Date Handling**: date-fns for date manipulation and formatting
- **Development Tools**: Replit-specific plugins for development environment integration

## Key Design Patterns
- **Service Layer**: Separate services for M3U8 parsing and download engine management
- **Repository Pattern**: Abstract storage interface with multiple implementations (memory, PostgreSQL)
- **Observer Pattern**: WebSocket-based real-time updates for download progress
- **Worker Thread Pattern**: Multi-threaded downloading for improved performance
- **Type Safety**: Full TypeScript coverage with shared type definitions between frontend and backend