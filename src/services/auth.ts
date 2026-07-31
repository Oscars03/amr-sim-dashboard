export interface User {
  id: string
  username: string
  token: string
}

export class AuthService {
  private currentUser: User | null = null

  login(username: string, password: string): User {
    if (!username || !password) {
      throw new Error('Username and password are required')
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters')
    }
    const user: User = {
      id: 'user-1',
      username,
      token: `token-${username}`,
    }
    this.currentUser = user
    return user
  }

  logout(): void {
    this.currentUser = null
  }

  getCurrentUser(): User | null {
    return this.currentUser
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null
  }
}
