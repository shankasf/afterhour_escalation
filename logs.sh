#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Docker container names
AI_CONTAINER="escalation-ai-service"
BACKEND_CONTAINER="escalation-backend"
FRONTEND_CONTAINER="escalation-frontend"

show_help() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}          After-Hours Escalation - Docker Log Viewer           ${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "Usage: ${GREEN}./logs.sh${NC} [service] [options]"
    echo ""
    echo -e "${YELLOW}Services:${NC}"
    echo -e "  ${GREEN}ai${NC}        - AI Service logs (Python/FastAPI)"
    echo -e "  ${GREEN}backend${NC}   - Backend logs (NestJS)"
    echo -e "  ${GREEN}frontend${NC}  - Frontend logs (Nginx/React)"
    echo -e "  ${GREEN}all${NC}       - All services (opens 3 terminals or combined)"
    echo ""
    echo -e "${YELLOW}Options:${NC}"
    echo -e "  ${GREEN}-f, --follow${NC}   Follow log output in real-time"
    echo -e "  ${GREEN}-n, --lines${NC}    Number of lines to show (default: 100)"
    echo -e "  ${GREEN}--since${NC}        Show logs since timestamp (e.g., 10m, 1h, 2h30m)"
    echo -e "  ${GREEN}--timestamps${NC}   Show timestamps"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo -e "  ./logs.sh ai                  # Show last 100 lines of AI service"
    echo -e "  ./logs.sh backend -f          # Follow backend logs in real-time"
    echo -e "  ./logs.sh ai -n 200           # Show last 200 lines"
    echo -e "  ./logs.sh backend --since 30m # Logs from last 30 minutes"
    echo -e "  ./logs.sh all -f              # Follow all services"
    echo ""
    echo -e "${YELLOW}Direct Docker Commands:${NC}"
    echo -e "  ${CYAN}docker logs -f escalation-ai-service${NC}"
    echo -e "  ${CYAN}docker logs -f escalation-backend${NC}"
    echo -e "  ${CYAN}docker logs -f escalation-frontend${NC}"
    echo ""
}

# Default values
LINES=100
FOLLOW=""
SINCE=""
TIMESTAMPS=""

# Parse arguments
SERVICE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        ai|backend|frontend|all)
            SERVICE="$1"
            shift
            ;;
        -f|--follow)
            FOLLOW="-f"
            shift
            ;;
        -n|--lines)
            LINES="$2"
            shift 2
            ;;
        --since)
            SINCE="--since $2"
            shift 2
            ;;
        --timestamps|-t)
            TIMESTAMPS="--timestamps"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

if [[ -z "$SERVICE" ]]; then
    show_help
    exit 1
fi

# Build docker logs command
build_cmd() {
    local container="$1"
    echo "docker logs --tail $LINES $TIMESTAMPS $SINCE $FOLLOW $container"
}

# Show header
show_header() {
    local service_name="$1"
    local color="$2"
    echo -e "${color}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${color}                    $service_name LOGS                         ${NC}"
    echo -e "${color}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Check if container is running
check_container() {
    local container="$1"
    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "${RED}Container '$container' is not running${NC}"
        echo -e "${YELLOW}Start it with: docker-compose up -d${NC}"
        return 1
    fi
    return 0
}

# Show logs based on service
case $SERVICE in
    ai)
        show_header "AI SERVICE" "$PURPLE"
        check_container "$AI_CONTAINER" && eval $(build_cmd "$AI_CONTAINER")
        ;;
    backend)
        show_header "BACKEND" "$GREEN"
        check_container "$BACKEND_CONTAINER" && eval $(build_cmd "$BACKEND_CONTAINER")
        ;;
    frontend)
        show_header "FRONTEND" "$CYAN"
        check_container "$FRONTEND_CONTAINER" && eval $(build_cmd "$FRONTEND_CONTAINER")
        ;;
    all)
        if [[ -n "$FOLLOW" ]]; then
            echo -e "${YELLOW}Following all services (Ctrl+C to stop)...${NC}"
            echo -e "${PURPLE}[AI]${NC} ${GREEN}[BACKEND]${NC} ${CYAN}[FRONTEND]${NC}"
            echo ""
            # Use docker-compose logs for combined following
            docker-compose logs -f --tail=$LINES ai-service backend frontend 2>/dev/null || \
            docker compose logs -f --tail=$LINES ai-service backend frontend
        else
            show_header "AI SERVICE" "$PURPLE"
            check_container "$AI_CONTAINER" && docker logs --tail $LINES $TIMESTAMPS $SINCE "$AI_CONTAINER"
            echo ""
            show_header "BACKEND" "$GREEN"
            check_container "$BACKEND_CONTAINER" && docker logs --tail $LINES $TIMESTAMPS $SINCE "$BACKEND_CONTAINER"
            echo ""
            show_header "FRONTEND" "$CYAN"
            check_container "$FRONTEND_CONTAINER" && docker logs --tail $LINES $TIMESTAMPS $SINCE "$FRONTEND_CONTAINER"
        fi
        ;;
esac
