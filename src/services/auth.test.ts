import { describe, it, expect, beforeEach } from 'vitest'
import { AuthService } from './auth'

describe('AuthService', () => {
  let authService: AuthService

  beforeEach(() => {
    authService = new AuthService()
  })

  it('should initialize with no authenticated user', () => {
    expect(authService.getCurrentUser()).toBeNull()
    expect(authService.isAuthenticated()).toBe(false)
  })

  it('should successfully log in with valid credentials', () => {
    const user = authService.login('admin', 'password123')
    expect(user.username).toBe('admin')
    expect(user.token).toBe('token-admin')
    expect(authService.getCurrentUser()).toEqual(user)
    expect(authService.isAuthenticated()).toBe(true)
  })

  it('should throw error when username or password is missing', () => {
    expect(() => authService.login('', 'password123')).toThrow('Username and password are required')
    expect(() => authService.login('admin', '')).toThrow('Username and password are required')
  })

  it('should throw error when password is too short', () => {
    expect(() => authService.login('admin', '12345')).toThrow('Password must be at least 6 characters')
  })

  it('should clear user session on logout', () => {
    authService.login('admin', 'password123')
    expect(authService.isAuthenticated()).toBe(true)
    
    authService.logout()
    expect(authService.getCurrentUser()).toBeNull()
    expect(authService.isAuthenticated()).toBe(false)
  })
})
