'use client'
import { createContext, useContext } from 'react'

export const ProfileContext = createContext(null)
export function useProfile() { return useContext(ProfileContext) }
