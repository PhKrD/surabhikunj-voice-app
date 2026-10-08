// Icons chosen by name at runtime (navigation from my_navigation(),
// notification categories, website categories, org branding).
//
// `import * as Icons from 'lucide-react'` pulled all ~1,500 icons (625 kB)
// into the app. This registry includes every name the database and app use
// today plus a broad set an admin might pick; unknown names fall back to a
// neutral circle instead of breaking the screen.
import {
  Activity, AlertCircle, AlertTriangle, Award, Baby, BarChart3, Bell, Book, BookOpen, Briefcase,
  Building2, Calendar, CalendarCheck, CalendarDays, Camera, CheckCircle2, CheckSquare, Cigarette,
  Circle, CircleOff, Clapperboard, ClipboardList, Clock, Coffee, Crosshair, Crown, Dices, EyeOff,
  FileText, Flag, Flame, Flower2, Gift, GitBranch, Globe, GraduationCap, HandHeart, HandHelping,
  Heart, HeartHandshake, Home, Image, Inbox, Landmark, LayoutDashboard, Leaf, Library, ListChecks,
  ListTodo, Mail, MapPin, Megaphone, MessageCircle, MessageSquare, MessageSquareWarning, Milk, Moon,
  Music, Newspaper, Package, Phone, Pill, Radio, Salad, School, Search, Send, Server, Settings,
  Shield, ShieldAlert, ShieldCheck, Smartphone, Sparkle, Sparkles, Star, Sun, Swords, Tag, Target,
  Timer, Trophy, Truck, User, UserCheck, UserCog, UserPlus, Users, Utensils, UtensilsCrossed, Video,
  Wallet, Wine, Wrench,
} from 'lucide-react'

export const ICONS = {
  Activity, AlertCircle, AlertTriangle, Award, Baby, BarChart3, Bell, Book, BookOpen, Briefcase,
  Building2, Calendar, CalendarCheck, CalendarDays, Camera, CheckCircle2, CheckSquare, Cigarette,
  Circle, CircleOff, Clapperboard, ClipboardList, Clock, Coffee, Crosshair, Crown, Dices, EyeOff,
  FileText, Flag, Flame, Flower2, Gift, GitBranch, Globe, GraduationCap, HandHeart, HandHelping,
  Heart, HeartHandshake, Home, Image, Inbox, Landmark, LayoutDashboard, Leaf, Library, ListChecks,
  ListTodo, Mail, MapPin, Megaphone, MessageCircle, MessageSquare, MessageSquareWarning, Milk, Moon,
  Music, Newspaper, Package, Phone, Pill, Radio, Salad, School, Search, Send, Server, Settings,
  Shield, ShieldAlert, ShieldCheck, Smartphone, Sparkle, Sparkles, Star, Sun, Swords, Tag, Target,
  Timer, Trophy, Truck, User, UserCheck, UserCog, UserPlus, Users, Utensils, UtensilsCrossed, Video,
  Wallet, Wine, Wrench,
}

/** Resolves an icon name from the database; unknown names get `fallback`. */
export function getIcon(name, fallback = Circle) {
  return (name && ICONS[name]) || fallback
}
