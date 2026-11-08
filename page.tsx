"use client";

import { useMemo, useState } from "react";
import {
  Search, ShoppingCart, UserRound, Smartphone, House, Watch, Gamepad2,
  Sparkles, Heart, Truck, ShieldCheck, CreditCard, Headphones, Plus, X,
  Minus, Menu, ArrowRight, Star, Zap, ChevronRight
} from "lucide-react";

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  oldPrice?: number;
  image: string;
  tag?: string;
  description: string;
};

const products: Product[] = [
  {
    id: 1, name: "Fone Bluetooth sem fio", category: "Eletrônicos",
    price: 89.90, oldPrice: 129.90,
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85",
    tag: "OFERTA", description: "Som envolvente para acompanhar sua rotina."
  },
  {
    id: 2, name: "Relógio inteligente esportivo", category: "Eletrônicos",
    price: 149.90, oldPrice: 199.90,
    image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85",
    tag: "MAIS VENDIDO", description: "Tecnologia e praticidade no seu pulso."
  },
  {
    id: 3, name: "Mochila urbana para o dia a dia", category: "Acessórios",
    price: 119.90,
    image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85",
    description: "Espaço e estilo para acompanhar você."
  },
  {
    id: 4, name: "Luminária moderna", category: "Casa",
    price: 79.90, oldPrice: 99.90,
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85",
    tag: "OFERTA", description: "Um toque especial para o seu ambiente."
  },
  {
    id: 5, name: "Óculos de sol clássico", category: "Moda",
    price: 69.90,
    image: "https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=900&q=85",
    description: "Um acessório versátil para todos os momentos."
  },
  {
    id: 6, name: "Controle para jogos", category: "Games",
    price: 159.9
